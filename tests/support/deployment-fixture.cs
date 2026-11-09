using System;
using System.IO;
using Microsoft.Win32;

// Isolated HKCU deployment fixture. Never installs a real application/service.
class DeploymentFixture {
    static int Main(string[] args) {
        if (args.Length != 3 || !args[1].StartsWith("wdb-cli-localhost-")) return 2;
        string mode=args[0], name=args[1], directory=Path.GetFullPath(args[2]);
        if (!Directory.Exists(directory) || !Path.GetFileName(directory).StartsWith("wdb-cli-localhost-")) return 3;
        string key="Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\"+name;
        if (mode=="uninstall") Registry.CurrentUser.DeleteSubKeyTree(key,false);
        else if (mode=="install" || mode=="update") {
            using(var app=Registry.CurrentUser.CreateSubKey(key)) {
                app.SetValue("DisplayName",name);
                app.SetValue("DisplayVersion",mode=="install"?"1.0.0":"2.0.0");
                app.SetValue("Publisher","WDB Test Fixture");
            }
        } else return 4;
        File.WriteAllText(Path.Combine(directory,mode+".marker"),mode);
        Console.WriteLine("fixture:"+mode);
        return 0;
    }
}
