/* ZD PDF Takeoff — the second DWG reader: ACadSharp (MIT, github.com/DomCR/ACadSharp) compiled to WebAssembly, run in the
   browser by takeoff/cad.js when the first reader (LibreDWG) cannot read a drawing — LibreDWG gets almost every object of some
   AutoCAD 2018 drawings wrong (their type and text come out, their points do not), which ACadSharp reads whole. Nothing is
   uploaded: the DWG is read here, in the page's worker, and handed back as a binary DXF, which cad.js reads as it reads the
   DXF this computer's AutoCAD saves.

   Built by tools/takeoff-dwg/build.ps1 into takeoff/dwg/ (the .NET runtime and the libraries, about 5 MB, loaded the first time
   a drawing needs it). From JavaScript: ZdDwg.ToDxf(bytes) → a line of JSON {ok, ents, notes, ver, ms} or {ok: false, error};
   the DXF itself goes out in pieces through the module import "zddwg".chunk, and what it is doing through "zddwg".step ("zddwg".restart:
   what went out so far is void — the drawing is written again). ACadSharp is built from its source with acadsharp.patch (a block's
   objects read only once it is used): the JADE masonry drawing, 53 MB, 1,016,357 objects of which 770,000 in blocks nothing inserts,
   is read in 668 MB instead of more than the browser's 4 GB. */
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Collections.Generic;
using System.Linq;
using ACadSharp;
using ACadSharp.Entities;
using ACadSharp.IO;
using ACadSharp.Tables;

public static partial class ZdDwg
{
    public static void Main() { }

    [JSImport("chunk", "zddwg")]
    internal static partial void Chunk([JSMarshalAs<JSType.MemoryView>] ArraySegment<byte> data);

    [JSImport("step", "zddwg")]
    internal static partial void Step(string what);

    [JSImport("restart", "zddwg")]
    internal static partial void Restart();

    [JSExport]
    public static string ToDxf(byte[] dwg)
    {
        var sw = Stopwatch.StartNew();
        int notes = 0, ents = 0, dropped = 0; string first = "";
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);   // the drawing's own code page (ANSI 1252, 1256…)
            CadDocument Read()
            {
                var cfg = new DwgReaderConfiguration { Failsafe = true, ReadSummaryInfo = false, KeepUnknownEntities = false };
                using (var ms = new MemoryStream(dwg, false))
                using (var r = new DwgReader(ms, (s, e) => { if (e.NotificationType == NotificationType.Error) { notes++; if (first == "") first = e.Message; } }) { Configuration = cfg })
                    return r.Read();
            }
            Step("read");
            var doc = Read();
            foreach (var b in doc.BlockRecords) ents += b.Entities.Count;
            try { dropped = Prune(doc); } catch (Exception) { dropped = -1; }
            GC.Collect();   // (the reader's own objects and the blocks left out, gone before the DXF is written)
            Step("dxf");
            try { Write(doc); }
            catch (Exception) when (dropped != 0)
            {   // the DXF writer turned down the drawing without its unused blocks: read again, written whole
                Restart(); doc = null; GC.Collect(); dropped = 0; doc = Read(); Write(doc);
            }
            return Json(true, $"\"ents\":{ents},\"dropped\":{dropped},\"notes\":{notes},\"first\":{Str(first)},\"ver\":{Str(doc.Header.Version.ToString())},\"ms\":{sw.ElapsedMilliseconds}");
        }
        catch (Exception e)
        {
            return Json(false, $"\"error\":{Str(e.GetType().Name + ": " + e.Message)},\"ents\":{ents},\"ms\":{sw.ElapsedMilliseconds}");
        }
    }

    static void Write(CadDocument doc)
    {
        using (var o = new Sink())
        {
            using (var w = new DxfWriter(o, doc, true)) w.Write();
            o.Flush();
        }
    }

    /* the blocks the drawing draws: those its model space and layouts insert, and theirs; dimensions' blocks, multileaders' arrowheads
       and contents, the dimension and multileader styles' arrowheads, a dynamic block's own definition. The others — definitions
       nothing inserts, three quarters of the JADE masonry drawing's objects — are left out of the DXF, which the takeoff then reads
       in a quarter of the time and memory. -> how many blocks were left out */
    static int Prune(CadDocument doc)
    {
        var used = new HashSet<BlockRecord>(); var todo = new Stack<BlockRecord>();
        void Add(BlockRecord b) { if (b != null && used.Add(b)) todo.Push(b); }
        foreach (var b in doc.BlockRecords)
            if (b.Name.StartsWith("*Model_Space", StringComparison.OrdinalIgnoreCase) || b.Name.StartsWith("*Paper_Space", StringComparison.OrdinalIgnoreCase)) Add(b);
        foreach (var d in doc.DimensionStyles) { Add(d.ArrowBlock); Add(d.DimArrow1); Add(d.DimArrow2); Add(d.LeaderArrow); }
        foreach (var m in doc.MLeaderStyles) { Add(m.Arrowhead); Add(m.BlockContent); }
        while (todo.Count > 0)
        {
            var b = todo.Pop(); Add(b.Source);
            foreach (var e in b.Entities)
                switch (e)
                {
                    case Insert i: Add(i.Block); break;
                    case Dimension d: Add(d.Block); break;
                    case MultiLeader m: Add(m.Arrowhead); Add(m.BlockContent); Add(m.ContextData?.BlockContent); break;
                }
        }
        var drop = doc.BlockRecords.Where(b => !used.Contains(b)).Select(b => b.Name).ToList();
        foreach (var n in drop) doc.BlockRecords.Remove(n);
        return drop.Count;
    }

    static string Json(bool ok, string rest) => "{\"ok\":" + (ok ? "true" : "false") + "," + rest + "}";
    static string Str(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s ?? "") b.Append(c == '"' || c == '\\' ? "\\" + c : c < ' ' ? " " : c.ToString());
        return b.Append('"').ToString();
    }

    /* the DXF as it is written, handed to JavaScript 4 MB at a time (the whole of a big one would not fit beside the drawing) */
    sealed class Sink : Stream
    {
        readonly byte[] buf = new byte[4 << 20]; int n; long done;
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => done + n;
        public override long Position { get => done + n; set => throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c)
        {
            while (c > 0)
            {
                int k = Math.Min(c, buf.Length - n);
                Buffer.BlockCopy(b, o, buf, n, k); n += k; o += k; c -= k;
                if (n == buf.Length) Flush();
            }
        }
        public override void Flush() { if (n > 0) { Chunk(new ArraySegment<byte>(buf, 0, n)); done += n; n = 0; } }
        public override int Read(byte[] b, int o, int c) => throw new NotSupportedException();
        public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
        public override void SetLength(long v) => throw new NotSupportedException();
    }
}
