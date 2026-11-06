# EasiClass 覆盖安装与卸载验证

2026-11-06，使用用户指定桌面安装包 `EasiClassSetup_1.0.13.698.exe`，通过 localhost CLI → SYSTEM 服务和登录用户助手完成验证。没有重启系统。

1. `apps.list` 同时列出机器范围和当前登录用户范围；旧 EasiClass 是用户范围安装，SYSTEM 的 HKCU 查询无法发现它。已修正枚举及按 `scope:user` 路由安装/卸载的行为，并加入真实临时 HKCU 条目回归测试。
2. CLI `push` 传输 157,333,351 字节安装包并校验 SHA-256。使用已确认的 NSIS `/S`、`/D=C:\Users\Tsingwill\AppData\Local\Programs\EasiClass` 参数，`apps.update` 以 SYSTEM 身份强制覆盖既有目录，约 24.9 秒退出 0。任务 ID：`aa20e5f0-0b5e-4789-82bc-ba7dc605d1d9`。
3. 新机器范围卸载记录显示版本 `1.0.13.698`；包内主程序文件版本为 `1.0.13.659`。原用户安装记录仍显示 `1.0.14`，属于两个不同封装的注册信息，不能只凭注册表判断覆盖成功。已核验文件变化、安装日志，并通过 `app.launch` 启动，观察到 EasiClass 实际窗口并保存截图。首次 2.5 秒查询尚无窗口，后续观察确认出现，没有盲目重复启动。
4. 关闭准确路径对应的 EasiClass 进程后，按各自注册 ID 调用新机器范围和旧用户范围卸载器。两次均退出 0；最终 `apps.list` 无 EasiClass 条目，窗口及主程序不存在。卸载器保留的安装目录/配置未额外删除。

这次验证是用户授权的**旧版本强制覆盖及卸载**，不代表已验证版本递增升级策略。测试后 EasiClass 保持已卸载状态。

证据：`artifacts/easiclass-deployment/` 下的 `push.json`、`install-result.json`、`apps-after-install.json`、`install.log`、`installed-app.png`、`report.json` 和各 CLI 任务结果。安装器及原卸载器备份仅保留在本机忽略目录，不进入 Git。

NSIS 参数依据：[官方安装器用法](https://nsis.sourceforge.io/Docs/Chapter3.html)。EXE 静默参数依安装器而定，不能默认所有 EXE 都支持 `/S`；本次卸载使用 `_?=安装目录` 避免自复制后父进程提前退出。
