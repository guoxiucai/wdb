using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Threading;
using System.Runtime.InteropServices;
using System.ComponentModel;

// Windows SCM host and hidden interactive-session helper supervisor.
// No desktop APIs execute inside the SYSTEM/session-0 service process.
internal sealed class WdbServiceHost : ServiceBase
{
    private readonly Dictionary<string,string> options;
    private readonly ManualResetEvent stopped = new ManualResetEvent(false);
    private Thread worker;
    private Process child;
    private readonly object gate = new object();
    private readonly object logGate = new object();
    private readonly bool helper;
    private IntPtr job = IntPtr.Zero;
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr handle, int type, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool AssignProcessToJobObject(IntPtr handle, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private WdbServiceHost(string[] args)
    {
        options = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "--helper") { helper = true; continue; }
            if (args[i].StartsWith("--") && i + 1 < args.Length) options[args[i]] = args[++i];
        }
        ServiceName = "WdbService";
        CanStop = true; CanShutdown = true; AutoLog = false;
    }
    private string Option(string key, string fallback) { string v; return options.TryGetValue(key, out v) ? v : fallback; }
    private static string Quote(string v) { return "\"" + v.Replace("\"", "\\\"") + "\""; }
    private void Log(string line)
    {
        try {
            string dir = Path.Combine(Option("--data-dir", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "wdb")), "logs");
            Directory.CreateDirectory(dir);
            string path = Path.Combine(dir, helper ? "helper-host.log" : "service-host.log");
            lock (logGate) {
                if (File.Exists(path) && new FileInfo(path).Length > 8 * 1024 * 1024) {
                    if (File.Exists(path + ".1")) File.Delete(path + ".1");
                    File.Move(path, path + ".1");
                }
                File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + line + Environment.NewLine);
            }
        } catch { /* Logging failure must not terminate service supervision. */ }
    }
    protected override void OnStart(string[] args)
    {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed");
        ExtendedLimits limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) {
            int error = Marshal.GetLastWin32Error(); CloseHandle(job); job = IntPtr.Zero;
            throw new Win32Exception(error, "Cannot establish process-tree cleanup");
        }
        worker = new Thread(RunLoop); worker.IsBackground = true; worker.Start();
    }
    private void RunLoop()
    {
        string node = Option("--node", "");
        string script = Option("--script", "");
        string data = Option("--data-dir", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "wdb"));
        string port = Option("--port", helper ? "18767" : "18766");
        string address = helper ? "127.0.0.1" : Option("--host", "127.0.0.1");
        System.Net.IPAddress parsedAddress;
        if (!System.Net.IPAddress.TryParse(address, out parsedAddress)) throw new ArgumentException("--host must be an IP address");
        Log("Supervisor started; identity=" + System.Security.Principal.WindowsIdentity.GetCurrent().Name + "; session=" + Process.GetCurrentProcess().SessionId);
        while (!stopped.WaitOne(0)) {
            int retryDelay = 2000;
            try {
                if (!Path.IsPathRooted(node) || !File.Exists(node)) { Log("WDB_RUNTIME_MISSING: bound Node path unavailable: " + node + "; repair installation; PATH fallback disabled."); stopped.WaitOne(30000); continue; }
                if (!File.Exists(script)) { Log("WDB_SCRIPT_MISSING: " + script + "; repair installation."); stopped.WaitOne(30000); continue; }
                ProcessStartInfo start = new ProcessStartInfo(node,
                    Quote(script) + " --data-dir " + Quote(data) + " --host " + Quote(address) + " --port " + port);
                start.WorkingDirectory = Path.GetDirectoryName(script);
                start.UseShellExecute = false; start.CreateNoWindow = true;
                start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                Process p = new Process(); p.StartInfo = start;
                p.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log(e.Data); };
                p.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) Log("stderr " + e.Data); };
                lock (gate) {
                    if (stopped.WaitOne(0)) break;
                    p.Start();
                    if (!AssignProcessToJobObject(job, p.Handle)) {
                        int error = Marshal.GetLastWin32Error(); try { p.Kill(); } catch { }
                        throw new Win32Exception(error, "Cannot contain runtime process tree");
                    }
                    child = p;
                }
                p.BeginOutputReadLine(); p.BeginErrorReadLine();
                Log("Child started pid=" + p.Id);
                while (!p.WaitForExit(500) && !stopped.WaitOne(0)) { }
                if (p.HasExited) { p.WaitForExit(); Log("Child exited code=" + p.ExitCode); if (p.ExitCode == 78) retryDelay = 30000; }
                lock (gate) { if (child == p) child = null; }
                p.Dispose();
            } catch (Exception ex) { Log(ex.GetType().Name + ": " + ex.Message); }
            stopped.WaitOne(retryDelay);
        }
    }
    protected override void OnStop()
    {
        stopped.Set();
        lock (gate) {
            if (child != null) {
                try {
                    ProcessStartInfo kill = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "taskkill.exe"), "/PID " + child.Id + " /T /F");
                    kill.UseShellExecute = false; kill.CreateNoWindow = true;
                    using (Process p = Process.Start(kill)) { p.WaitForExit(10000); }
                } catch (Exception ex) { Log("Stop: " + ex.Message); }
            }
        }
        if (worker != null) worker.Join(12000);
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        Log("Supervisor stopped");
    }
    protected override void OnShutdown() { OnStop(); }
    private static void Main(string[] args)
    {
        using (WdbServiceHost host = new WdbServiceHost(args)) {
            if (host.helper) { host.OnStart(new string[0]); host.worker.Join(); }
            else ServiceBase.Run(host);
        }
    }
}
