---
knowledgeId: "parallel-computing"
moduleId: "architecture"
title: "37. 并行计算与异构计算"
description: "并行计算与异构计算（国网 37）"
order: 37
status: "handbook"
syllabusNumber: 37
source: "《电网招聘_计算机类_强化复习手册》第 37 节；对应国网 2027 大纲专业知识第 37 项。"
tags: ["并行计算与异构计算","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：并行性来自多核/多线程/SIMD/GPU；异构系统用不同计算单元匹配任务特征。

**怎么做**
- Flynn 分类 SISD、SIMD、MISD、MIMD；多核 CPU 常为 MIMD，向量指令体现 SIMD。
- Amdahl：串行比例限制固定规模加速比；Gustafson 从可扩展工作负载角度解释加速。
- GPU 适合大量同构并行任务，但内存传输、线程分歧、同步与显存带宽可能成瓶颈。
- 并行效率 `E=S/p`；任务并行与数据并行不同；锁、原子操作和内存一致性用于保证并发正确性。

**易错**：核数翻倍不保证时间减半；吞吐量与单请求延迟可能相反变化。
