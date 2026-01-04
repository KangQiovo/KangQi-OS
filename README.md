# KangQi OS

KangQi OS 是一个以网页形式呈现的多媒体与工具集合式桌面界面，包含音乐播放器、粒子背景、摄像头子应用和即时聊天等模块。项目主要由 `index.html` 前端页面和 `server.js` Socket.IO 后端组成，可直接在浏览器中体验或通过 Node.js 提供聊天与实时交互能力。

## 功能概览
- **多媒体播放**：本地文件播放、网易云音乐搜索与播放（需配置 `API_BASE_URL` 指向 NeteaseCloudMusicApi 服务），支持线性波形可视化、歌词滚动、收藏歌单等体验。
- **桌面与窗口系统**：多场景切换、任务栏、通知、桌面部件（天气、倒计时等）及可拖拽窗口，提供类似桌面操作系统的交互。
- **即时通信**：通过 Socket.IO 支持公共聊天、私信与好友请求，前端会在连接后显示当前会话 ID 并允许选择聊天对象。
- **附加工具**：内置摄像头子应用（以 iframe 方式按需加载）、服务工作线程注册、背景粒子特效等。

## 运行方式
1. **安装依赖**（仅聊天等实时功能需要）：
   ```bash
   npm install express socket.io
   ```
2. **启动 Socket.IO 服务**：
   ```bash
   node server.js
   ```
   服务器默认监听 `3000` 端口，并允许任意来源跨域访问，方便将前端静态文件分域部署。如果前端通过 HTTPS 访问，请确保反向代理为 Socket.IO 提供了 HTTPS/WSS 支持。
3. **打开前端页面**：
   - 直接用浏览器打开 `index.html` 可体验大部分前端交互；
   - 若要使用聊天/好友等实时功能，请在同一网络下访问运行中的 `server.js` 服务，并确保页面中的连接地址指向该服务器。

## 目录说明
- `index.html`：主要界面与交互逻辑，包含音乐播放、桌面 UI、可视化和工具模块。
- `server.js`：基于 Express + Socket.IO 的简单后端，用于公共聊天、私聊及好友请求转发。
- `KangQi_OS.png`：项目相关的图片资源（同时用作性能排行入口图标）。

## 相关链接
- 网易云音乐 API（示例）：<https://github.com/Binaryify/NeteaseCloudMusicApi>
- Socket.IO 文档：<https://socket.io/docs/v4/>

## 手机性能排行（ReDroid 部署）
若需要在“功能”板块中打开手机性能排行应用，可使用 ReDroid 运行 Android 实例并通过流式方式嵌入：

1. **启动 ReDroid 虚拟机**（需要主机具备 KVM 支持）：
   ```bash
   docker run -itd --name redroid --privileged \
     -v /dev/kvm:/dev/kvm \
     -p 5555:5555 \
     ghcr.io/redroid/redroid:13.0.0-latest \
     androidboot.redroid_width=1280 androidboot.redroid_height=720 androidboot.redroid_fps=60
   ```
2. **连接并安装性能排行应用**：
   ```bash
   adb connect <服务器IP>:5555
   adb install <性能排行APK路径>
   adb shell monkey -p <性能排行包名> 1   # 启动应用
   ```
3. **开启 Web 端镜像流**（示例使用 ws-scrcpy，将画面通过 HTTP 暴露给前端 iframe）：
   ```bash
   npm install -g ws-scrcpy   # 或使用对应的 Docker 镜像
   ws-scrcpy --serial <服务器IP>:5555 --port 6080 --bit-rate 8M --max-size 1280
   ```
   完成后可通过 `http://<服务器IP>:6080/` 访问实时画面，前端会在点击“性能排行”图标时载入该地址。
4. **配置前端入口**：如需自定义流地址，可在加载 `index.html` 前设置 `window.PERF_APP_URL = 'http://<服务器IP>:6080/';`，或直接使用同源部署时的默认 `http://localhost:6080`。

完成以上步骤后，点击功能板块中的 “性能排行” 图标即可在页面内通过 iframe 打开应用界面。
