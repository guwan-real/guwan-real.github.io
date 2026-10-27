---
knowledgeId: "os-security"
moduleId: "os"
title: "30. 操作系统安全与保护"
description: "OS 安全与保护（国网 30）"
order: 30
status: "handbook"
syllabusNumber: 30
source: "《电网招聘_计算机类_强化复习手册》第 30 节；对应国网 2027 大纲专业知识第 30 项。"
tags: ["操作系统安全与保护","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：用用户/内核隔离、虚拟内存权限、访问控制和审计保护资源。

**怎么做**：`r/w/x` 权限、ACL、能力列表、最小权限、进程隔离、ASLR、DEP/NX；区分认证与授权；Linux 文件权限八进制如 `755=rwxr-xr-x`，目录 `x` 意味着可穿越/检索路径。

**易错**：文件可读不等于目录可列出；root 权限仍受某些安全机制约束。
