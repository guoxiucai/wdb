# macOS CLI 验收记录

2026-11-06 14:47—14:48，Asia/Shanghai。**Mac → Windows 的仅地址首次连接、人工同意并记住、13步 LAN 闭环已通过**。本地28项客户端回归和5项离线包校验全部通过。用户在 Windows 本机点击授权，测试工具没有代替用户同意。

## 环境与追溯

| 项目 | 实际值 |
|---|---|
| Mac | MacBook Pro / Apple M5 / arm64 / 24 GB |
| macOS | 26.7.2，build 25G332 |
| 运行时 | 官方 Node v24.15.0 darwin-arm64；开发机原有全局 Node v22.19.0，验收不使用它 |
| Node 归档 SHA-256 | `372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4`，与官方清单一致 |
| 产品 / 协议 | `0.1.0` / `/v1`、protocolVersion 1 |
| 源码 | Mac 基线 `aace86b`；远端更新至 `379e608`；合并验证版本 `ceabaca`。最终包源码 SHA 和是否脏工作树以 `BUILD-INFO.json` 为准 |
| Mac / Windows 网络 | `172.20.115.38` → `172.20.115.75:18766`，en7 直连路由 |
| 已核对 Windows 身份 | `qingwei / 2f493aacf427f3e9 / 0.1.0`，win32/x64，protocolVersion 1，服务 PID 32076 |
| Windows 执行环境 | 服务身份 SYSTEM；桌面助手 `QINGWEI\Tsingwill`，session 1，desktop.available=true；默认 shell 验证为非提权用户 |

## 最新配对实现检查

已合并共享 `src/cli.js` / `src/client-transport.js` 的仅地址首连、独立 TLS 证书发现、固定指纹、审批等待及临时授权恢复；无需另写 Mac 协议实现。保留 Mac 默认配置目录、迁移、0700/0600 和独立运行时。修正合并后遗留的旧配对码测试及 Mac 使用说明，重新生成离线包。

首次使用信任只在新身份执行；已有证书不自动替换。审批请求独立等待150秒，不受普通请求10秒限时打断，也不在响应丢失时自动重发。拒绝不保存新凭据；显式connect才会请求审批，普通操作及watch不会自动弹窗。旧pairing-code参数被接受但不发送、不参与授权。

## 跨机器实际结果

| 操作 | 观察与结论 |
|---|---|
| 无配对材料首次连接 | `connect 172.20.115.75 --name 'MacBook Pro · WDB CLI'`；仅地址连接成功，用户在真实Windows弹窗同意并记住；返回remembered=true |
| 身份及私有配置 | deviceId与预期一致；默认Mac配置目录0700、devices.json为0600；stdout/报告无token |
| 真实LAN脚本 | 包内运行时执行`validate-lan.js`，13步全部succeeded，report.passed=true |
| 文件 | 中文/空格目录、中文文本与1 MiB随机二进制往返；逐字节一致；唯一远端临时目录已清理 |
| 屏幕/窗口/截图 | screens、windows.list、screenshot成功；PNG下载校验通过，3840×2160截图已实际查看，确为当前Windows桌面 |
| 断开/重连 | 本地先显示disconnected，随后connect成功；clientId/deviceId保持一致，不再弹窗；服务端clients确认remembered=true、authorized=true |
| 在线观察 | 包内CLI的devices --watch输出online及最终duration_limit，NDJSON可解析 |

本轮实际客户端ID为`d6609a1d-005f-48fa-945e-7db5a4242679`。连接保留可用，便于继续调试。此处是Mac与Windows两台机器的真实LAN验证，不是服务器自身LAN IP回环自测。

## 已通过

| 检查 | 结果与边界 |
|---|---|
| 客户端回归 | 28 项通过、0 失败、0 跳过。使用本机临时生成测试证书，不复制 Windows 服务私钥 |
| 启动器 | 任意 cwd、中文/空格包路径、相对/绝对符号链接链及 PATH 入口；仅使用包内 Node；运行时缺失明确失败 |
| 配置 | `--config` > `WDB_CONFIG` > Mac 默认目录；仅新目录不存在时复制旧配置，保留旧文件；新目录即使为空也不合并；已有目录/文件权限修正为 0700/0600；配置符号链接拒绝 |
| 配对 / 身份夹具 | 自动证书发现不发送HTTP；发现有期限且失败不落盘；可选错误指纹服务收到0请求；已存证书不自动替换；审批拒绝不落盘；等待独立于普通超时；临时续期保留身份；撤销后仅显式connect重新申请；成功配对不输出token；多设备歧义、错误deviceId及不兼容协议明确失败 |
| 任务 / 重连夹具 | 接受回包丢失时两次提交 body 完全相同、只执行一次；不支持去重时不重发；断开后的查询恢复并报告 SERVICE_RESTARTED/unknown，不重提任务 |
| 信号 | 子进程真实接收 SIGINT：普通 waiter 退出且未发 cancel，服务任务仍 running；显式 cancel 可取消；watch/follow 退出 0 并产生最终 interrupted JSON |
| 编码 / 参数文件 | 中文、多行、emoji JSON；本地 args/script/expression 文件；Windows path/cwd 和 PowerShell `$env` 内容保留 |
| 文件夹具 | 随机二进制与中文目录往返；hash 不符拒绝并清理；默认不覆盖；符号链接上传拒绝；显式下载覆盖替换链接本身，不修改其指向文件；本机大小写及 Unicode 归一化别名冲突明确失败 |
| 大长度边界 | 接收声明 `4294967313` 字节的响应后注入断流，进度长度未截为 32 位，原目标保留且 `.wdb-part` 清理；**不是完成了 4 GiB 传输** |
| 包完整性 | 5 项通过：移动至中文/空格目录、禁网且 PATH 无全局 Node 时启动；篡改、缺文件、多余文件、符号链接、清单越界/重复、执行位丢失均被拒绝 |
| 远端可达性 | 初期只做过TLS 1.3探测；本轮已进一步完成实际配对、认证操作和LAN闭环 |

包内容采用明确清单，只带 3 个共享客户端源码文件、arm64 Node/许可证、Mac 启动器、校验/验收脚本、同一 Skill 与文档。没有 Windows 服务/桌面助手、FFmpeg、npm、凭据、截图或测试证书。

本机证据（Git 忽略）：

- `artifacts/macos-consent/client-tests.log`：28 项客户端回归。
- `artifacts/macos-consent/package-tests.log`：5 项离线包和负向校验。
- `artifacts/macos-consent/connect.json`、`info.json`、`config-check.json`、`authorization.json`、`devices-watch.jsonl`：配对、身份、权限及授权验证，不含token。
- `artifacts/macos-consent/lan-smoke/report.json`：13步完整报告；同目录`desktop.png`已实际查看。
- `artifacts/macos-consent/summary.json`：clientId保持一致、记住授权及截图尺寸汇总。
- `artifacts/macos-consent/package-verification.json`：最终交付包文件校验、版本和运行时位置。
- `dist/wdb-client-macos-arm64/BUILD-INFO.json` 与 `SHA256SUMS.txt`：最终交付追溯和逐文件校验。

## 未通过完整验收的部分

以下是待验收范围，不列入通过项：

- Mac发起后的人工拒绝/关闭、人工不勾选记住和临时许可重新审批；相应客户端分支已有夹具覆盖，本轮人工路径为同意并记住。
- MP4 拉取查看、UIA / Electron / Flutter 的观察→动作→业务状态闭环；本轮仅查询屏幕/窗口并查看真实截图。
- 真实断网恢复、Windows 服务重启 unknown、远端授权撤销和多客户端竞争。对应的客户端恢复分支已有本地协议夹具覆盖。
- ≥1 GiB 不可压缩文件吞吐、完整 >4 GiB 文件往返、不同卷、真实大小写敏感卷及多屏。
- macOS 14 实机、另一台从未安装 Node/npm 的 Mac、带下载隔离属性的外部分发、签名/公证。本轮在 macOS 26.7.2 通过了禁网及隔离 PATH 启动，不等同于上述机器矩阵。
- Windows 全套回归。本轮最初尝试 `tests/device-id.test.js` 时两项因缺少专用 `.runtime/server/tls.pfx` 失败，未复制服务私钥补环境；最终 Mac 回归入口明确只运行客户端三个测试文件。

## 复现

```sh
./scripts/build-client-macos.sh
./dist/wdb-client-macos-arm64/runtime/node --test tests/cli.test.js tests/macos-client.test.js tests/client-portable.test.js
WDB_TEST_PACKAGE="$PWD/dist/wdb-client-macos-arm64" ./dist/wdb-client-macos-arm64/runtime/node --test tests/macos-package.test.js
./dist/wdb-client-macos-arm64/runtime/node ./dist/wdb-client-macos-arm64/scripts/verify-package.js
```

构建已存在的输出目录会拒绝覆盖。重新构建请先移开旧包或指定新路径。首次连接运行`bin/wdb connect 172.20.115.75`并由Windows操作者确认，然后运行：

```sh
./dist/wdb-client-macos-arm64/runtime/node ./dist/wdb-client-macos-arm64/scripts/validate-lan.js \
  --device 172.20.115.75 --output ./artifacts/mac-lan-smoke
```

未记住的客户端会在脚本disconnect/connect步骤再次需要Windows操作者确认。真实截图应实际查看后再判断桌面验收，后续业务和压力测试结果单独更新。
