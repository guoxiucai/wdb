# WDB Windows Server 0.1.2

Windows x64 四组合签名安装包，生成日期 2026-11-17。

| Node | FFmpeg | 安装包 |
| --- | --- | --- |
| 内置 24.15.0 | 包含 | wdb-server-0.1.2-windows-x64-with-node-with-ffmpeg-setup.exe |
| 内置 24.15.0 | 不含 | wdb-server-0.1.2-windows-x64-with-node-no-ffmpeg-setup.exe |
| 外部 >=22 | 包含 | wdb-server-0.1.2-windows-x64-external-node-with-ffmpeg-setup.exe |
| 外部 >=22 | 不含 | wdb-server-0.1.2-windows-x64-external-node-no-ffmpeg-setup.exe |

所有组合默认使用 Windows 原生无声录屏，不采集声音。external-node 自动检测系统默认目录和 PATH 中通过权限、签名、版本及架构校验的 Node，并允许手动修改；无有效候选时显示原因和解决办法。FFmpeg 构建输入随工程固定保存，不依赖下载。安装指南见 ../../docs/WINDOWS-INSTALLERS.md。

构建 ID：server-0-1-2-20261117-01。产物源码：bb3dfd56e900301dd1f9b1dffc6ec50c6ac507f9，构建源树干净。后续交付提交只添加本目录的产物和说明，产物源码 SHA 保持上述值。

验证：Windows 11 本机自动化回归 218 项，196 pass、0 fail、22 skip；skip 不计通过。四个 Setup 的 Authenticode 均为 Valid 且含时间戳；四种 payload 完整性和 FFmpeg 包含/排除检查通过，导出后重新核对 SHA-256。构建沿用本地 TrustManualSignatures；manifest 如实记录 user-managed-not-validated，独立验签结果如上。

本轮 0.1.2 未真实安装，未执行 Win10/其他硬件/Mac 实机验证，不以此前 0.1.1 的实机结果替代。未发布 npm 或公开 Release，未推送 Git。SHA256SUMS.txt 为本目录最终签名文件校验值。
PR 交付说明：原始 ffmpeg.exe 超过 GitHub 普通 Git 单文件上限，且 public fork 不允许上传新的 LFS 对象。因此 PR 使用 vendor/ffmpeg/ffmpeg.zip 保存同一依赖，构建时本地解压，分别核对归档及 exe 的 SHA-256，无网络下载。该调整仅影响构建输入保存方式；本目录四个已签名安装器保持上述构建原始字节及校验值。PR 分支从上游 main 汇总这些改动，原构建源码 SHA 为保留的本地 feature/no-ffmpeg 分支提交。上文未推送描述打包时状态，后续向上游提交 PR 会推送交付分支。
