/* ZD PDF Takeoff — the second DWG reader: ACadSharp (MIT, github.com/DomCR/ACadSharp) compiled to WebAssembly, run in the
   browser by takeoff/cad.js when the first reader (LibreDWG) cannot read a drawing — LibreDWG gets almost every object of some
   AutoCAD 2018 drawings wrong (their type and text come out, their points do not), which ACadSharp reads whole. Nothing is
   uploaded: the DWG is read here, in the page's worker, and handed back as a binary DXF, which cad.js reads as it reads the
   DXF this computer's AutoCAD saves.

   Built by tools/takeoff-dwg/build.ps1 into takeoff/dwg/ (the .NET runtime and the libraries, about 5 MB, loaded the first time
   a drawing needs it). From JavaScript: ZdDwg.ToDxf(bytes) → a line of JSON {ok, ents, notes, ver, ms} or {ok: false, error};
   the DXF itself goes out in pieces through the module import "zddwg".chunk, and what it is doing through "zddwg".step. */
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using ACadSharp;
using ACadSharp.IO;

public static partial class ZdDwg
{
    public static void Main() { }

    [JSImport("chunk", "zddwg")]
    internal static partial void Chunk([JSMarshalAs<JSType.MemoryView>] ArraySegment<byte> data);

    [JSImport("step", "zddwg")]
    internal static partial void Step(string what);

    [JSExport]
    public static string ToDxf(byte[] dwg)
    {
        var sw = Stopwatch.StartNew();
        int notes = 0, ents = 0; string first = "";
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);   // the drawing's own code page (ANSI 1252, 1256…)
            Step("read");
            var cfg = new DwgReaderConfiguration { Failsafe = true, ReadSummaryInfo = false, KeepUnknownEntities = false };
            CadDocument doc;
            using (var ms = new MemoryStream(dwg, false))
            using (var r = new DwgReader(ms, (s, e) => { if (e.NotificationType == NotificationType.Error) { notes++; if (first == "") first = e.Message; } }) { Configuration = cfg })
                doc = r.Read();
            foreach (var b in doc.BlockRecords) ents += b.Entities.Count;
            Step("dxf");
            using (var o = new Sink())
            {
                using (var w = new DxfWriter(o, doc, true)) w.Write();
                o.Flush();
            }
            return Json(true, $"\"ents\":{ents},\"notes\":{notes},\"first\":{Str(first)},\"ver\":{Str(doc.Header.Version.ToString())},\"ms\":{sw.ElapsedMilliseconds}");
        }
        catch (Exception e)
        {
            return Json(false, $"\"error\":{Str(e.GetType().Name + ": " + e.Message)},\"ents\":{ents},\"ms\":{sw.ElapsedMilliseconds}");
        }
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
