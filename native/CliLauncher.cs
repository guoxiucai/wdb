using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;

// Console launcher: keeps the caller's identity, console, working directory and exit code.
public static class CliLauncher {
    static string Quote(string value) {
        var b=new StringBuilder("\"");int slashes=0;
        foreach(char c in value) {
            if(c=='\\'){slashes++;continue;}
            if(c=='"'){b.Append('\\',slashes*2+1);b.Append(c);}
            else {b.Append('\\',slashes);b.Append(c);}slashes=0;
        }
        b.Append('\\',slashes*2);return b.Append('"').ToString();
    }
    public static int Main(string[] args) {
        try {
            string root=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,".."));
            var binding=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(root,"runtime-binding.json")));
            string node=Convert.ToString(binding["path"]);
            if(!Path.IsPathRooted(node)||!File.Exists(node))throw new IOException("Configured Node runtime is missing. Repair the WDB installation.");
            var command=new StringBuilder(Quote(Path.Combine(root,"src","cli.js")));
            foreach(string arg in args)command.Append(' ').Append(Quote(arg));
            ConsoleCancelEventHandler cancel=delegate(object sender,ConsoleCancelEventArgs e){e.Cancel=true;};
            Console.CancelKeyPress+=cancel;
            try {using(var child=Process.Start(new ProcessStartInfo(node,command.ToString()){UseShellExecute=false})) {child.WaitForExit();return child.ExitCode;}}
            finally {Console.CancelKeyPress-=cancel;}
        } catch(Exception e){Console.Error.WriteLine("WDB launcher: "+e.Message);return 1;}
    }
}
