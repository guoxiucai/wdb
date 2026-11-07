# 参与 WDB 开发

感谢帮助改进 WDB。项目采用 [MIT 许可证](LICENSE)，目前仍在开发中，正式发布参数将另行公布。提交改动前请阅读 [AGENTS.md](AGENTS.md)，其中的技术、权限、测试与提交规则适用于整个仓库。

## 报告问题

普通问题请使用 [GitHub Issues](https://github.com/guoxiucai/wdb/issues)，包含：

- WDB 版本或源码 SHA、服务端 Windows build、CLI 系统和 Node 版本。
- 最小复现命令、预期结果、实际结果及发生频率。
- 脱敏后的错误码和日志；注明来自源码、npm 包还是 EXE 安装。
- 连接方式（localhost / 跨主机 LAN）、授权方式和应用构建类型等相关条件。

不要上传客户端凭据、私钥、配对材料、业务截图或终端秘密。安全漏洞按 [SECURITY.md](SECURITY.md) 私下报告。

## 提交修改

1. 大范围功能先在 Issue 说明具体场景与接口影响，小修复可直接提交 PR。
2. 从最新主线创建分支，保持修改范围清晰，不混入无关重排或生成产物。
3. 运行与修改相关的测试，补充有意义的行为测试；纯文档修改检查命令、链接与事实即可。
4. 同步受影响的 CLI 帮助、用户指南、协议、Skill 和打包白名单。
5. 每个可独立验证的步骤单独提交，使用 `feat(scope): ...`、`fix(scope): ...`、`test(scope): ...`、`docs: ...` 等标题。
6. PR 描述说明问题、改变后的行为、实际验证及未覆盖的平台；不要将 skip 或模拟测试表述为实机通过。

开发环境、构建命令见 [README](README.md#development)。Windows 服务安装/故障注入会操作本机，先使用独立测试目录与测试窗口，并阅读对应验证脚本。改动默认在 Development 包验证，不自动发布 npm、创建 Release 或变更许可。

## 评审重点

共享客户端需保持 Windows/macOS 边界；普通用户 helper 与 SYSTEM 服务不能静默互相替代。关注证书验证、授权归属、任务去重、流控、取消与资源回收。新行为应有用户能理解的失败结果和明确的恢复办法。参考 [流协议](docs/INTERACTIVE-SHELL-AND-FORWARDING.md) 与 [Windows 实测记录](docs/STREAMING-WINDOWS-VERIFICATION.md)。
