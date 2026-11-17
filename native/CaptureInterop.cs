using System;
using System.Runtime.InteropServices;

// Explicit Win32 COM ABI. Slots are from the Windows SDK headers; every owned
// pointer is released exactly once by its owner, without shared RCW lifetimes.
internal static class MediaNative {
 internal static T Method<T>(IntPtr p,int slot) where T:class {return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(p),slot*IntPtr.Size),typeof(T));}
 internal static void Check(int hr){if(hr<0)Marshal.ThrowExceptionForHR(hr);}
 internal static void Release(ref IntPtr p){if(p!=IntPtr.Zero){Marshal.Release(p);p=IntPtr.Zero;}}
 internal static IntPtr Query(IntPtr p,string iid){Guid g=new Guid(iid);IntPtr q;Check(Marshal.QueryInterface(p,ref g,out q));return q;}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Empty(IntPtr p);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int OutPointer(IntPtr p,out IntPtr q);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Pointer(IntPtr p,IntPtr q);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int IndexPointer(IntPtr p,int index,out IntPtr q);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int SetU32(IntPtr p,ref Guid key,int value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int SetU64(IntPtr p,ref Guid key,long value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int SetGuid(IntPtr p,ref Guid key,ref Guid value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int GetGuid(IntPtr p,ref Guid key,out Guid value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int GetU64(IntPtr p,ref Guid key,out long value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Time(IntPtr p,long time);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int BufferLock(IntPtr p,out IntPtr data,out int max,out int length);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Integer(IntPtr p,int value);
 internal static void U32(IntPtr p,string key,int value){Guid k=new Guid(key);Check(Method<SetU32>(p,21)(p,ref k,value));}
 internal static void U64(IntPtr p,string key,long value){Guid k=new Guid(key);Check(Method<SetU64>(p,22)(p,ref k,value));}
 internal static void GUID(IntPtr p,string key,string value){Guid k=new Guid(key),v=new Guid(value);Check(Method<SetGuid>(p,24)(p,ref k,ref v));}
 internal const string Major="48eba18e-f8c9-4687-bf11-0a74c9f96a8f",Subtype="f7e34c9a-42e8-4714-b74b-cb29d72c35e5",Size="1652c33d-d6b2-4012-b834-72030849a37d",Rate="c459a2e8-3d2c-4e44-b132-fee5156c7bb0",Video="73646976-0000-0010-8000-00aa00389b71",H264="34363248-0000-0010-8000-00aa00389b71",NV12="3231564e-0000-0010-8000-00aa00389b71";
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFStartup(int version,int flags);
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFShutdown();
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFCreateMediaType(out IntPtr p);
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFCreateAttributes(out IntPtr p,int count);
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFCreateSample(out IntPtr p);
 [DllImport("mfplat.dll",ExactSpelling=true)] internal static extern int MFCreateMemoryBuffer(int length,out IntPtr p);
 [DllImport("mfreadwrite.dll",CharSet=CharSet.Unicode,ExactSpelling=true)] internal static extern int MFCreateSinkWriterFromURL(string url,IntPtr stream,IntPtr attributes,out IntPtr writer);
 [DllImport("mfreadwrite.dll",CharSet=CharSet.Unicode,ExactSpelling=true)] internal static extern int MFCreateSourceReaderFromURL(string url,IntPtr attributes,out IntPtr reader);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int AddStream(IntPtr p,IntPtr type,out int index);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int SetInput(IntPtr p,int index,IntPtr type,IntPtr attributes);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int WriteSample(IntPtr p,int index,IntPtr sample);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int ReadSample(IntPtr p,int index,int control,out int actual,out int flags,out long time,out IntPtr sample);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int NativeType(IntPtr p,int stream,int typeIndex,out IntPtr type);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int ReaderType(IntPtr p,int stream,IntPtr reserved,IntPtr type);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int StreamSelection(IntPtr p,int stream,int selected);
 internal static IntPtr VideoType(string subtype,int width,int height,int fps){IntPtr p;Check(MFCreateMediaType(out p));try{GUID(p,Major,Video);GUID(p,Subtype,subtype);U64(p,Size,((long)width<<32)|(uint)height);U64(p,Rate,((long)fps<<32)|1);U64(p,"c6376a1e-8d0a-4027-be45-6d9a0ad39bb6",(1L<<32)|1);U32(p,"e2724bb8-e676-4806-b4b2-a8d6efb44ccd",2);return p;}catch{Release(ref p);throw;}}
 [StructLayout(LayoutKind.Sequential)] internal struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] internal struct OutputDesc {[MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)]public string name;public Rect bounds;public int attached,rotation;public IntPtr monitor;}
 [StructLayout(LayoutKind.Sequential)] internal struct TextureDesc {public int width,height,mips,array,format,samples,quality,usage,bind,cpu,misc;}
 [StructLayout(LayoutKind.Sequential)] internal struct Mapped {public IntPtr data;public int rowPitch,depthPitch;}
 [StructLayout(LayoutKind.Sequential)] internal struct FrameInfo {public long present,mouse;public int accumulated,coalesced,protectedContent,x,y,visible,metadata,pointerSize;}
 [DllImport("dxgi.dll",ExactSpelling=true)] internal static extern int CreateDXGIFactory1(ref Guid iid,out IntPtr factory);
 [DllImport("d3d11.dll",ExactSpelling=true)] internal static extern int D3D11CreateDevice(IntPtr adapter,int driver,IntPtr software,int flags,IntPtr levels,int count,int sdk,out IntPtr device,out int level,out IntPtr context);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int GetOutputDesc(IntPtr p,out OutputDesc desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Duplicate(IntPtr p,IntPtr device,out IntPtr duplication);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Acquire(IntPtr p,int timeout,out FrameInfo info,out IntPtr resource);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate void GetTextureDesc(IntPtr p,out TextureDesc desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int CreateTexture(IntPtr p,ref TextureDesc desc,IntPtr data,out IntPtr texture);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate void CopyResource(IntPtr p,IntPtr destination,IntPtr source);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate int Map(IntPtr p,IntPtr texture,int subresource,int type,int flags,out Mapped mapped);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] internal delegate void Unmap(IntPtr p,IntPtr texture,int subresource);
}
