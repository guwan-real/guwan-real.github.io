---
knowledgeId: "physical-layer"
moduleId: "networks"
title: "18. 物理层"
description: "物理层（国网 18；南网网络 2）"
order: 18
status: "handbook"
syllabusNumber: 18
source: "《电网招聘_计算机类_强化复习手册》第 18 节；对应国网 2027 大纲专业知识第 18 项。"
tags: ["物理层","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：物理层负责比特在介质上传送，包括编码、调制、带宽和接口。

**怎么做**
- Nyquist 理想无噪声基带最大码元速率 `2B` Baud；若每码元 M 种状态，则上限 `2B log₂M` bit/s（理想条件）。
- Shannon 信道容量 `C=B log₂(1+S/N)` bit/s，`SNR_dB=10log₁₀(S/N)`，先把 dB 转线性。
- 双绞线/同轴/光纤比较损耗、抗干扰和带宽；单模光纤适合长距离。

**易错**：码元率 Baud 不一定等于比特率 bps。
