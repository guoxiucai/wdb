using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
// Read-only presentation fixture: never calls connection.approve or attaches allow handlers.
public static class ApprovalLayoutFixture {
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    static object Rect(Rectangle r) {return new {x=r.X,y=r.Y,width=r.Width,height=r.Height};}
    [STAThread] public static int Main(string[] args) {
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        var type=Assembly.LoadFrom(args[0]).GetType("DesktopBridge").GetNestedType("ApprovalDialog",BindingFlags.NonPublic);
        using(var form=(Form)Activator.CreateInstance(type,new object[]{args[2]})) {
            var ownedFonts=new List<Font>();
            form.Text="WDB DPI preview - no authorization";
            var timer=new Timer{Interval=750};
            float scale=args.Length>3?float.Parse(args[3],System.Globalization.CultureInfo.InvariantCulture):1F;
            form.Shown+=delegate {
                // Explicit geometry/font stress only; this is NOT a real Windows DPI change.
                if(scale!=1F) {
                    var fonts=new Dictionary<Control,Font>();
                    Action<Control> visit=null;visit=c=>{fonts[c]=new Font(c.Font.FontFamily,c.Font.Size*scale,c.Font.Style);ownedFonts.Add(fonts[c]);foreach(Control child in c.Controls)visit(child);};visit(form);
                    form.AutoScaleMode=AutoScaleMode.None;form.Scale(new SizeF(scale,scale));
                    foreach(var pair in fonts)pair.Key.Font=pair.Value;
                    form.Location=new Point(5,5);
                }
                timer.Start();
            };
            int ticks=0;
            timer.Tick+=delegate {
                timer.Stop();
                try {
                    var controls=new List<object>();var failures=new List<string>();var rectangles=new List<Rectangle>();
                    foreach(string field in new[]{"Identity","Heading","Remember","Countdown","Allow","Deny"}) {
                        var c=(Control)type.GetField(field).GetValue(form);
                        var desired=c.GetPreferredSize(new Size(c.Width,0));
                        var bounds=form.RectangleToClient(c.RectangleToScreen(c.ClientRectangle));
                        if(c.Height<desired.Height)failures.Add(field+": clipped height");
                        if(c.Width<desired.Width)failures.Add(field+": clipped width");
                        if(!form.ClientRectangle.Contains(bounds))failures.Add(field+": outside client");
                        foreach(var other in rectangles)if(other.IntersectsWith(bounds))failures.Add(field+": overlapping controls");
                        rectangles.Add(bounds);
                        controls.Add(new {field=field,bounds=Rect(bounds),preferred=new {width=desired.Width,height=desired.Height},fontSize=c.Font.Size,text=c.Text});
                    }
                    if(!Screen.FromHandle(form.Handle).WorkingArea.Contains(form.Bounds))failures.Add("window outside work area");
                    var data=new {dpi=GetDpiForWindow(form.Handle),simulatedScale=scale,window=Rect(form.Bounds),client=Rect(form.ClientRectangle),handle=form.Handle.ToInt64(),controls=controls,failures=failures};
                    File.WriteAllText(args[1],new JavaScriptSerializer().Serialize(data));
                    if(++ticks>=40)form.Close();else timer.Start();
                }catch(Exception e){File.WriteAllText(args[1],new JavaScriptSerializer().Serialize(new{error=e.ToString()}));form.Close();}
            };
            Application.Run(form);timer.Dispose();
            form.Dispose();foreach(var font in ownedFonts)font.Dispose();
        }
        return 0;
    }
}
