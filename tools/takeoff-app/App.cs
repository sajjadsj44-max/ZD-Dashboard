/* ZD Takeoff — PDF Takeoff as a small Windows app: one .exe, its own window (Windows' WebView2, the Edge engine every
   Windows 10 / 11 PC has), no address bar, no developer tools, no browser menus, and nothing outside the takeoff opens in it.

   First run from anywhere (Downloads, a USB stick): it copies itself to %LOCALAPPDATA%\Programs\<name>, puts a shortcut on the
   Desktop and in the Start menu, and starts from there. Its projects are kept in %LOCALAPPDATA%\<name>\data (the app's own
   browser storage), the same as in a browser: on this computer only.

   Built by tools/takeoff-app/build.ps1 (Windows' own C# compiler, C# 5): the WebView2 libraries are inside the .exe, and the
   address it opens is in Config.cs, written by the build (not kept as plain text). OWNER builds the full app (password sa),
   the default build the friends' link (?team, a login per friend). */
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle(Config.Name)]
[assembly: AssemblyProduct(Config.Name)]
[assembly: AssemblyDescription("PDF Takeoff")]
[assembly: AssemblyCompany("Zameen Developments")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program {
  public static string Home, Site, AppDir, DataDir, BinDir, Exe;
  static string Plain(string s) {   // Config's addresses: base64 of the bytes XOR 0x5A
    byte[] b = Convert.FromBase64String(s);
    for (int i = 0; i < b.Length; i++) b[i] ^= 0x5A;
    return Encoding.UTF8.GetString(b);
  }
  [STAThread]
  static void Main(string[] args) {
    AppDomain.CurrentDomain.AssemblyResolve += Resolve;
    string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    AppDir = Path.Combine(local, "Programs", Config.Name);
    DataDir = Path.Combine(local, Config.Name, "data");
    BinDir = Path.Combine(local, Config.Name, "bin");
    Exe = Path.Combine(AppDir, Config.Name + ".exe");
    Home = Plain(Config.Home); Site = Plain(Config.Site);
    bool quiet = Array.IndexOf(args, "--quiet") >= 0;
    if (!string.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(Exe), StringComparison.OrdinalIgnoreCase)) {
      if (Install(quiet)) return;   // installed (or updated): the installed copy is started
    }
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Start();
  }
  static bool Install(bool quiet) {
    try {
      Directory.CreateDirectory(AppDir);
      File.Copy(Application.ExecutablePath, Exe, true);
    } catch (IOException) {
      MessageBox.Show(Config.Name + " is open — close it, then run this file again to update it.", Config.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
      return true;
    } catch (Exception) { return false; }   // can't install here: run from where it is
    Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Config.Name + ".lnk"));
    Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), Config.Name + ".lnk"));
    if (quiet) return true;
    MessageBox.Show(Config.Name + " is installed. Open it any time from the shortcut on your Desktop or in the Start menu.", Config.Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
    Process.Start(new ProcessStartInfo(Exe) { WorkingDirectory = AppDir });
    return true;
  }
  static void Shortcut(string path) {
    try {
      Type t = Type.GetTypeFromProgID("WScript.Shell");
      object sh = Activator.CreateInstance(t);
      object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { path });
      Type lt = lnk.GetType();
      lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { Exe });
      lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { AppDir });
      lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { Exe + ",0" });
      lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { Config.Name });
      lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
    } catch (Exception) { }
  }
  static byte[] Res(string name) {
    using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name)) {
      if (s == null) return null;
      MemoryStream m = new MemoryStream(); s.CopyTo(m); return m.ToArray();
    }
  }
  static Assembly Resolve(object sender, ResolveEventArgs e) {   // the WebView2 libraries come from inside the .exe
    string n = new AssemblyName(e.Name).Name;
    if (n != "Microsoft.Web.WebView2.Core" && n != "Microsoft.Web.WebView2.WinForms") return null;
    byte[] b = Res(n + ".dll");
    return b == null ? null : Assembly.Load(b);
  }
  public static void Loader() {   // the native loader must be a file: written next to the app's data, again when it changes
    byte[] b = Res("WebView2Loader.dll");
    string f = Path.Combine(BinDir, "WebView2Loader.dll");
    Directory.CreateDirectory(BinDir);
    if (!File.Exists(f) || new FileInfo(f).Length != b.Length) File.WriteAllBytes(f, b);
  }
  [MethodImpl(MethodImplOptions.NoInlining)]
  static void Start() { Application.Run(new AppForm(false)); }   // (a method of its own: WebView2 is loaded only once Resolve is in place)
}

class AppForm : Form {
  static CoreWebView2Environment Env;
  static readonly HashSet<string> KeepMenu = new HashSet<string> { "cut", "copy", "paste", "pasteAndMatchStyle", "selectAll", "undo", "redo", "emoji" };
  WebView2 web;

  public AppForm(bool popup) {
    Text = Config.Name;
    try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
    Size = new Size(1280, 820);
    StartPosition = FormStartPosition.CenterScreen;
    if (!popup) WindowState = FormWindowState.Maximized;
    BackColor = Color.FromArgb(0xee, 0xf2, 0xf7);
    web = new WebView2();
    web.Dock = DockStyle.Fill;
    web.DefaultBackgroundColor = BackColor;
    Controls.Add(web);
    if (!popup) Load += async (s, e) => {
      try { await Init(); web.CoreWebView2.Navigate(Program.Home); }
      catch (Exception ex) {
        MessageBox.Show("This computer needs the Microsoft Edge WebView2 Runtime (free, from Microsoft) to run " + Config.Name + ".\n\n" + ex.Message, Config.Name, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        Close();
      }
    };
  }

  public async Task Init() {
    if (Env == null) {
      Program.Loader();
      CoreWebView2Environment.SetLoaderDllFolderPath(Program.BinDir);
      Env = await CoreWebView2Environment.CreateAsync(null, Program.DataDir);
    }
    await web.EnsureCoreWebView2Async(Env);
    CoreWebView2 c = web.CoreWebView2;
    CoreWebView2Settings st = c.Settings;
    st.AreDevToolsEnabled = false;            // no Inspect, F12 or Ctrl+Shift+I
    st.IsStatusBarEnabled = false;            // no address in the corner when a link is pointed at
    st.AreBrowserAcceleratorKeysEnabled = false;   // no view-source (Ctrl+U), browser print or find bars; the takeoff's own keys still work
    st.AreHostObjectsAllowed = false;
    st.IsGeneralAutofillEnabled = false;
    st.IsPasswordAutosaveEnabled = false;
    c.DocumentTitleChanged += (s, e) => { Text = Config.Name; };
    c.NavigationStarting += (s, e) => { if (!Allowed(e.Uri)) { e.Cancel = true; Outside(e.Uri); } };
    c.FrameNavigationStarting += (s, e) => { if (!Allowed(e.Uri)) e.Cancel = true; };
    c.NewWindowRequested += NewWindow;
    c.ContextMenuRequested += OnMenu;
    c.WindowCloseRequested += (s, e) => Close();
  }

  static bool Allowed(string u) {
    if (string.IsNullOrEmpty(u)) return true;
    return u.StartsWith(Program.Site, StringComparison.OrdinalIgnoreCase) || u.StartsWith("about:") || u.StartsWith("blob:") || u.StartsWith("data:");
  }
  static void Outside(string u) {   // a link out of the takeoff: another site in the computer's browser; the repository never
    try {
      Uri x = new Uri(u);
      bool web = x.Scheme == "https" || x.Scheme == "http";
      if (web && x.Host.IndexOf("github", StringComparison.OrdinalIgnoreCase) >= 0) return;
      if (web || x.Scheme == "mailto" || x.Scheme == "zd-cad") Process.Start(u);   // zd-cad: the AutoCAD helper on this PC
    } catch (Exception) { }
  }

  async void NewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e) {   // a print preview or report: a window of this app
    if (!Allowed(e.Uri)) { e.Handled = true; Outside(e.Uri); return; }
    CoreWebView2Deferral d = e.GetDeferral();
    try {
      AppForm f = new AppForm(true);
      if (e.WindowFeatures.HasSize && e.WindowFeatures.Width > 100) f.Size = new Size((int)e.WindowFeatures.Width + 16, (int)e.WindowFeatures.Height + 40);
      f.Show();
      await f.Init();
      e.NewWindow = f.web.CoreWebView2;
      e.Handled = true;
    } catch (Exception) { e.Handled = true; }
    finally { d.Complete(); }
  }

  static void OnMenu(object sender, CoreWebView2ContextMenuRequestedEventArgs e) {   // only cut / copy / paste: no Back, Save as, Print or address
    IList<CoreWebView2ContextMenuItem> m = e.MenuItems;
    for (int i = m.Count - 1; i >= 0; i--) if (!KeepMenu.Contains(m[i].Name)) m.RemoveAt(i);
    if (m.Count == 0) e.Handled = true;
  }
}
