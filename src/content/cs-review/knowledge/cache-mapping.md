---
knowledgeId: cache-mapping
moduleId: architecture
title: "Cache 直接映射：先按块编号"
description: "在字节地址、主存块号和 Cache 行号之间建立清晰的对应关系。"
order: 3
status: example
source: "项目自编示例，用于验证复习与刷题流程；非官方大纲正文。"
tags: ["Cache","地址映射"]
---

## 核心概念
直接映射规定每个主存块只能放入一个固定的 Cache 行。不同主存块可能竞争同一行。

## 工作原理
按字节编址时，先用地址除以块大小得到主存块号，再对 Cache 行数取余，得到行号。标记用来区分映射到同一行的不同主存块。

## 关键公式
$$
B=\left\lfloor A/L\right\rfloor,\qquad
i=B\bmod N,\qquad t=\left\lfloor B/N\right\rfloor
$$
$A$ 是字节地址，$L$ 是块大小，$N$ 是 Cache 行数。块内偏移为 $A\bmod L$。

## 常见考法
计算行号、标记位数、索引位数、块内偏移位数；分析冲突失效。

## 解题思路
例：Cache 数据容量为 1 KiB、块大小为 16 B，共 64 行。主存块号 69 的行号为 $69\bmod64=5$，标记为 1。这里容量指数据区，不含标记和控制位。

## 容易混淆
不要直接把字节地址对行数取余。KiB 表示 1024 字节；题目说容量时要辨明是否包含标记、有效位等开销。

## 关联练习
先列出块大小和行数，再进行除法与取余。
