# Windows DPI 验证

连接授权窗口按文字内容计算高度，长设备名自动换行；桌面桥启用 .NET Framework 4.8 的 PerMonitorV2。发行包必须同时包含 `native/bin/DesktopBridge.exe` 和相邻的 `DesktopBridge.exe.config`，不能只更新 EXE。

截图、屏幕边界和输入坐标使用虚拟桌面的物理像素；150% 缩放不代表需要将截图坐标再乘 1.5。显示配置发生变化后重新执行 `wdb screens`，使用新的 `layoutId`。

## 可重复检查

在已解锁的 Windows 开发机预编译桌面桥，分别在系统显示设置的 100%、125%、150%、175%、200% 下运行：

```powershell
node --test tests/desktop-dpi.test.mjs
```

测试只创建没有连接授权处理器的预览窗口，不批准真实客户端。它检查短/长设备名、控件文字尺寸、控件重叠、工作区边界，以及窗口/区域/桌面截图的物理像素尺寸、坐标偏移和失效布局拒绝。证据写入 Git 忽略的 `dev_doc/dpi/`。多显示器环境需另外验证跨不同 DPI 显示器移动窗口，以及负坐标布局；单屏测试不能代替这些情况。测试完成后恢复原显示设置。

可指定已安装桌面桥：

```powershell
$env:WDB_DPI_BRIDGE = 'C:\Program Files\wdb\native\bin\DesktopBridge.exe'
node --test tests/desktop-dpi.test.mjs
```

另有 100%～300% 的字体与几何尺寸压力测试：

```powershell
$env:WDB_DPI_LAYOUT_STRESS = '1'
node --test tests/desktop-dpi.test.mjs
Remove-Item Env:WDB_DPI_LAYOUT_STRESS
```

这个模式不修改操作系统 DPI，不能作为对应系统缩放比例的实测结论。实际缩放以报告的 `dpi` 为准，模拟倍率另记在 `simulatedScale`。
