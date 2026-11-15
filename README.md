# 论文检索客户端

<img src="assets/icon-256.png" width="96" alt="论文检索图标">

非官方清华大学学位论文检索客户端。适合需要按专业、学号查找论文，并在同一个窗口里浏览和保存 PDF 的读者。

- 内嵌原网站，自动修正“学科名”与接口“专业”字段不一致的问题。
- 支持多标签页、独立登录会话、原生“另存为”和下载记录。
- 默认文件名按 `论文题目_姓名_学院或培养单位_专业_学位_答辩日期.pdf` 组成，不包含学号；缺失项跳过，保存前可手动修改。
- 保存当前已获准访问的 PDF，保留水印；不绕过网站认证或下载授权。

## 直接使用

Windows 便携版位于 `release/ThesisBrowser-1.0.6-win-x64.exe`，也可从公开的 [GitHub Release](https://github.com/wangyendt/thu-thesis-browser/releases/latest) 下载。双击运行，无需 Python 或 Node.js。

登录状态与旧版共用本机应用数据目录。使用新版本前关闭旧版；图标若仍显示缓存中的旧样式，可取消固定旧快捷方式，再固定新版本。

Windows 版已构建和测试。macOS、Linux 提供构建配置，尚未实机验证。发布包未购买签名证书。

## 开发与构建

使用 Node.js 24 或更新版本，在仓库根目录执行：

```sh
npm ci
npm start
npm test
npm run dist:win
```

在对应操作系统运行 `npm run dist:mac` 或 `npm run dist:linux`。手动触发的 GitHub Actions 配置位于 `.github/workflows/build.yml`。公开源码仓库为 [wangyendt/thu-thesis-browser](https://github.com/wangyendt/thu-thesis-browser)，默认分支为 `main`；推送代码不会自动运行构建工作流。

```sh
npm run test:desktop
npm run test:pdf:live
npm run test:packaged
```

最后一项需要先构建 Windows 版，会在含 `~` 的目录里验证真正的打包程序，避免 Windows 短路径 URL 编码造成的 IPC 校验回归。测试使用独立配置，不借用实际账号登录状态。

## 图标

`assets/icon.svg` 是矢量源文件。执行 `npm run icons`，生成 PNG、多尺寸 ICO 和 ICNS。

EXE 文件、便携启动器、窗口、任务栏和应用内标识使用同一套图标。Windows 保留图标和版本资源编辑，但不进行代码签名，不能把 `signAndEditExecutable` 改为 `false`。

## 仓库范围

源码从论文仓库的 `tools/thu-thesis-browser` 复制到此独立仓库，原目录保留。`node_modules`、`release`、测试缓存及登录数据不提交到 Git。

详细使用方法与修复记录见 [使用说明](使用说明.txt)。
