# CS Review：架构与内容维护

## 仓库检查与集成方案

开发基线为 `9cd5367`。现有项目为 Astro 6.4.2 + TypeScript，无客户端 UI 框架；首页为 `src/pages/index.astro`，全局 CSS 为纸色、深绿、衬线字体。`.github/workflows/pages.yaml` 使用 Node 24、`npm ci`、`npm run build`，只在 main 推送或手动触发时部署 GitHub Pages。

本附录继承字体与色彩，使用独立布局 `CSReviewLayout.astro` 和 `cs-review.css`，不导入首页全局 CSS。首页只增加一个 Appendix / CS Review 导航链接。保留原有部署方式，不需要服务器、账号或新仓库。

静态路由：

- `/appendix/cs-review/`：练习入口、继续会话与八个章节。
- `knowledge/` 与 `knowledge/<稳定ID>/`：全文搜索、Markdown、LaTeX、代码高亮、目录、已复习标记及关联练习。
- `handbook/`：完整原稿阅读、题型决策表、原稿 Markdown 下载与大纲 PDF。
- `practice/`：章节、知识点、随机、错题、收藏、模拟考试；原生 TypeScript 管理交互。
- `mistakes/`：待复习、历史错题、收藏、不确定，支持章节筛选和分页。
- `progress/`：明确口径的学习统计及备份恢复。

所有页面和 JSON 数据均在构建时生成。浏览器的查询参数只筛选练习，不作为动态服务器路由；刷新可直接访问。模块内部通过 `BASE_URL` 生成路径，当前用户主页部署在域名根路径。

## 内容状态与接入手册

已接入用户提供的《电网招聘_计算机类_强化复习手册》完整原稿和《计算机类专业 2027 版》大纲 PDF。大纲第 2、3 页列出的 **48 项专业知识**逐项对应 48 个知识页；手册 **24 个专项**附在相关知识页后，整本原稿与两份附录也可直接阅读。公共与行业知识不属于本工具的复习主线。

题库共 **58 道自编练习**：48 道按手册逐节编写的自测题，加上原来的 10 道示例。每题标注来源、解析和对应知识点，不冒充官方真题。48 项映射表示条目已接入，不代表穷尽考试内容、官方题目分布或用户已掌握。

原稿位于 `src/content/cs-review/handbook.md`，PDF 位于 `public/appendix/cs-review/resources/sgcc-2027-computer-syllabus.pdf`，两者均按原始字节保存；`source-manifest.json` 记录来源文件名与 SHA-256。手册里的南网对照说明按原文保留，尚未单独核验南网原始 PDF，不以此宣称核对完成。

`src/content/cs-review/syllabus.json` 管理大纲编号、官方条目名称、知识点 ID 和专项映射。`npm run import:handbook` 从原稿重新生成分节页面，只调整展示结构，不改写正文或专项内容。更换新版本手册时，应有意识地更新来源记录；测试会检查原稿哈希以及 48 节、24 个专项的完整保留。原有十个知识点 URL 沿用，因此旧书签与题目关联仍然有效。

知识库在 `src/content/cs-review/knowledge/*.md`，使用 Astro Content Collections。每个文件名必须等于 frontmatter 的 `knowledgeId`：

```yaml
---
knowledgeId: stable-topic-id
moduleId: algorithms
title: 知识点标题
description: 简介
order: 1
status: handbook # example 表示自编示例，handbook 表示已接入手册
syllabusNumber: 1 # 对应提供的大纲中的专业知识序号
source: 原始手册名称与章节
tags: [排序, 复杂度]
---
```

正文支持 `$...$` 与 `$$...$$` 数学公式、代码块、表格及二级标题导航。原始 HTML 被移除；链接协议由 rehype-sanitize 过滤，KaTeX 使用 `trust: false`。Shiki 在构建时高亮，无浏览器高亮运行时。不要使用 MDX、脚本、事件属性或任意 HTML 承载内容。

## 题库模型与批量接入

题库在 `src/content/cs-review/questions/*.json`，每个文件是题目数组。可以按章节或来源分文件。数据类型和运行时约束见 `src/lib/cs-review/content-schema.ts`，录入参考 `examples.json`。

每题包括：`id`、`revision`、`moduleId`、`knowledgeIds`、`type`、`stem`、`options`、`correctOptionIds`、`explanation`（analysis、steps、keyPoint、pitfall）、`difficulty`、`source`（label、isExample、可选 url）、`tags`。

ID 使用稳定的小写短横线格式，发布后不要复用旧 ID 给不同的题。更改题干、选项或答案时增加 `revision`，防止旧会话按新答案判分。历史提交保留其版本；含已更新或已删除题目的会话会提示重新开始。判断题使用 T / F；多选必须至少两个正确项。所有关联知识点必须存在且属于同一模块。跨模块题目可选择一个主模块，在该模块内建立综合知识点。

批量导入题目时将数据转换成这个数组结构，新增 JSON 文件后运行 `npm run check:content`。校验重复 ID、基本字段、选项唯一性、答案合法性和知识点关联。构建会自动再次校验，非法内容不能上线。浏览器里的 JSON 导入功能用于个人学习记录，不用于发布题库。

## 判分与静态边界

单选 / 判断只允许选择一项；多选采用集合完全一致判分，不计部分分数。普通练习提交后锁定该题选择，显示解析；切题不自动提交。再次练习创建新的会话，历史不覆盖。

`data/questions.json` 只有题干、选项和元数据，不包含答案与解析。答案为独立的 `data/answers/<id>.json` 静态文件：普通练习在提交当前题后请求，模拟考试在确认交卷后才请求。模拟考试不计时，每题 1 分，未答题计错；判分文件全部加载成功后才一次性写入结果，失败可重试。交卷前不渲染正误、答案或知识点解析链接，刷新与切题也不会提前请求答案。

这是个人静态学习工具，答案文件本身公开可访问，不提供防作弊或试卷保密。真正保密需要服务端，不在本项目范围。

## 学习记录、口径与恢复

学习记录存于独立 LocalStorage 键 `guwan.cs-review.v1`，包含版本、逐次提交、题目标记、主动复习标记和当前会话。支持最多 50,000 条提交；导入最大 10 MiB。写入使用 Web Locks 串行化同源页面更新，写前重读最新记录；不支持 Web Locks 的旧浏览器建议只打开一个练习页。

提交 ID 为 `会话ID:题目ID`，刷新或重复提交不会重复累计。会话被另一页替换时拒绝旧页继续写入。题目标记的修改时间用于备份合并；同 ID 不同内容的提交会拒绝导入，避免静默覆盖。

“曾经做错”基于全部错误历史；“仍需复习”基于最近错误是否晚于手动掌握标记。一次正确不会抹去旧错误，再次错误会重新进入待复习。收藏和不确定是独立标记。“已复习”只表示用户主动记录阅读，不代表掌握。

累计提交与总正确率包含重复练习、模拟考试未答题，以及已移除题目的历史。模块统计按当前题目 ID 归组并包含旧版本提交；覆盖题数按 ID 去重。薄弱知识点按当前待复习题数排序，不能视为能力测量或大纲覆盖率。七天记录按浏览器所在设备日期统计。

导出格式为 `{ format: "guwan-cs-review", exportedAt, data }`。恢复先校验完整结构和会话一致性，再预览、合并去重，优先保留本地当前会话；遇到更高版本、损坏记录、异常存储或配额不足，会保留原始数据并显示警告。此时可导出当前暂存数据与原始记录，清空后再恢复。只清理本模块的存储键，不使用 `localStorage.clear()`。

不提供账号、后端或自动跨设备同步。浏览器数据不保证永久保存，隐私模式或清理网站数据可能丢失，请定期导出。

## 验证

```sh
npm ci
npm test
npm run build
npm run test:static
npm run preview
```

测试覆盖内容合法性、判分、错题生命周期、重复提交、备份合并、损坏 / 高版本记录保护、配额异常与会话恢复。浏览器验收还需要检查移动 / 桌面布局、键盘操作、刷新持久化、备份下载上传以及模拟交卷前的请求与页面状态。验证结果见本次 PR。
