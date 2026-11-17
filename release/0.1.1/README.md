# WDB Windows Server 0.1.1

Windows x64 签名安装包，发布于 2026-11-17。

- `wdb-server-0.1.1-windows-x64-with-node-setup.exe`：内置 Node 24.15.0。
- `wdb-server-0.1.1-windows-x64-external-node-setup.exe`：使用受保护路径下、签名有效的 Node >=22.0.0。
- `SHA256SUMS.txt`：签名后的最终 SHA-256。

两个包属于同一安装通道，可升级切换。首次安装默认支持局域网；升级保留已有网络设置、设备身份及已记住的授权。连接弹窗现在左侧“拒绝”、右侧“同意”，默认焦点及回车/Esc 的拒绝行为不变。

安装说明见 [Windows 安装器指南](../../docs/WINDOWS-INSTALLERS.md)。本次只发布 Windows 服务端附件，不执行 npm 发布。

## 构建与验收

构建 ID：`server-0-1-1-20261117`。源码：`c501010092ff90c8bab98980434e28b23ea708ac`，构建工作区干净；本目录产物及说明在后续提交中加入，二进制来源仍为该源码提交。

本机 Windows 11 x64（build 28000）验证：

- 完整自动化回归：200 通过、11 跳过、0 失败；跳过项不计为通过。
- 两种安装器、18 个 payload 文件及卸载程序：Authenticode 有效且有时间戳。Node 保留上游签名。
- 含 Node 升级、切换外部 Node 22.0.0、卸载、含 Node 重装通过；PATH、设备身份、证书及已记住授权保留，外部 Node 文件不变。
- 重装后服务 API、已配对访问、交互 shell / TCP 转发实机回归与 3 秒录屏产物校验通过。
- 签名桌面桥的普通/长设备名弹窗与截图像素检查通过，当前真实 DPI 为 96（100%）。

本轮未进行独立 Windows 10/干净 Windows、跨主机 LAN 或 Mac 实机验收。完整本机日志、录屏和截图仅保存于 Git 忽略目录，不作为公开附件。
