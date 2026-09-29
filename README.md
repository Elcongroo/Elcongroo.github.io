# congroo 的个人博客

congroo 的个人技术笔记。Astro 7 + TypeScript + Markdown/MDX；浏览器按页面加载主题切换、目录筛选、路径交互与按需全文搜索的小段逻辑，不使用数据库或应用后端。

当前内容：63 份可公开技术原稿、6 篇标注待作者审阅的补充研究稿、1 篇独立实验文章与 1 条实验日志。文章按系列、主题、稿件来源与系统栈模块组织。技术主线保留 13 个模块，并提供 IKE、ESP、OpenVPN 和 PQC 的分步交接示意。

原稿的 244 张 Mermaid 图在构建时转换为 SVG，正文关闭 JavaScript 仍可阅读。补充稿没有回写来源文档仓库。机构背景、内部任务、采购和职业规划不作为公开内容发布。

- [写作与更新指南](docs/写作与更新指南.md)：内容模型、状态、来源和组件。
- [文章模板](docs/文章模板.md)：新文章的元数据与正文结构。

## 开发与构建

使用 Node.js 22.12+，建议 Node 24 和随附的新版本 npm。GitHub 工作流采用 Node 24。以下命令在本项目目录依次执行，不需要管理员权限：

```bash
npm ci
npm run check
npm run build
npm run check:output
npm run preview
```

`npm ci` 按锁文件安装依赖；`check` 做类型与内容检查；`build` 先生成静态页面再构建全文索引；`check:output` 检查本地引用与关键输出；`preview` 提供构建产物的本地地址。开发时使用 `npm run dev`，检验搜索用完成构建后的 `preview`。

运行目录错误会找不到 package.json；安装失败先检查 Node/npm 版本与网络；构建失败不得将旧 dist 当作新版本。当前 Astro 的 dev 命令可能启动后台进程，结束可用 `npx astro dev stop`；preview 在前台时用 Ctrl+C 停止。

## 目录与发布边界

```text
src/content/posts/   文章，Markdown 或 MDX
src/content/lab/     实验台账，Markdown
src/pages/index.astro 首页与手动维护的个人简介
src/components/     状态标签、搜索与技术内容块
public/downloads/   独立示例脚本、原始输出和校验值
scripts/             Markdown基址处理与产物检查
.github/workflows/  GitHub Pages自动发布
```

文章不是公司知识库镜像。LAB-001 的代码由 Codex 编写并真实运行，作者本人复现尚未完成。VERIFIED 只覆盖对应原始记录中的用例。

`draft: true` 从页面、RSS和搜索索引排除，但源码仍包含原文。私有内容不能靠 draft 字段获得保护，不要将它放进公开仓库。

`PUBLIC_SITE=true` 控制索引提示与预览文案，不是认证。真正访问控制由托管平台设置。

## 可迁移构建

本站使用 GitHub Pages。更新 `main` 分支后，GitHub Actions 自动检查、构建、生成搜索索引并发布。在仓库 Settings → Pages 中选择 GitHub Actions；发布状态在 Actions 中查看。构建失败时不会替换上一版站点。站点地址为 https://elcongroo.github.io/ 。

`SITE_URL` 是 origin，`BASE_PATH` 是网站子路径。GitHub工作流自动读取二者；EdgeOne/Cloudflare根域名部署时设置自己的SITE_URL、BASE_PATH=/、PUBLIC_SITE=true，构建命令 npm run build，输出 dist。

Mermaid图使用 beautiful-mermaid 在构建时生成 SVG，已验证本次原稿使用的 flowchart、sequenceDiagram 和 stateDiagram 等语法；packet-beta 与 timeline 的实际原稿子集由 scripts/render-extra-diagram.mjs 转为 SVG。它不是完整 Mermaid 渲染器；复杂语法、扩展指令应单独验证，不能静默假定兼容。浏览器不加载 Mermaid 库。

英文优先使用系统 Times New Roman，缺失时依次回退到 Times、Liberation Serif 和衬线字体；中文使用自托管 Noto Serif SC，代码使用 JetBrains Mono。不引用远端字体 CDN。依赖许可证以各包许可证为准。

## 原稿导入与维护

导入工具需要显式提供经人工筛选的本地目录与私有发布清单；工具不自动遍历发布源仓库。清单包含需公开的文档、模块关联、节选范围和脱敏规则，应保留在公开仓库之外。

```bash
python3 scripts/import-reviewed-notes.py /path/to/docs --catalog /path/to/private-catalog.json --check
```

`src/data/publication-sources.json` 保存公开标题、源文件版本和正文校验值。修改导入逻辑后先重新生成并核对公开版差异。普通新增文章不需要经过导入工具。
