---
knowledgeId: "system-overview"
moduleId: "architecture"
title: "31. 计算机系统概述"
description: "计算机系统、层次与性能（国网 31；南网组成 1）"
order: 31
status: "handbook"
syllabusNumber: 31
source: "《电网招聘_计算机类_强化复习手册》第 31 节；对应国网 2027 大纲专业知识第 31 项。"
tags: ["计算机系统概述","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：ISA 是软件与硬件接口；CPU、主存、I/O 通过总线/互联协作，冯·诺依曼机程序与数据共存。

**怎么做**
- CPU 执行时间 `CPU Time=IC×CPI/Clock Rate`；时钟频率高不必然程序快。
- 加速比 `S=T_old/T_new`；Amdahl 定律 `S=1/((1-p)+p/s)`，p 为原执行时间中可加速比例。
- 吞吐量衡量单位时间处理多少任务；响应时间衡量任务完成时长；MIPS 等指标跨指令集易误导。
- 计算机层次：数字逻辑→微体系结构→指令集 ISA→操作系统→应用语言。

**易错**：时钟周期 = 频率的倒数；CPI 与指令总数也影响总时间。
