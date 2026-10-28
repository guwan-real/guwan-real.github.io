---
knowledgeId: "sql"
moduleId: "databases"
title: "12. 关系数据库标准语言 SQL"
description: "SQL（国网 12；南网数据库 3）"
order: 12
status: "handbook"
syllabusNumber: 12
source: "《电网招聘_计算机类_强化复习手册》第 12 节及专项 E2；对应国网 2027 大纲专业知识第 12 项。"
tags: ["关系数据库标准语言 SQL","国网2027","复习手册"]
---

## 原理与解题方法

**原理**：SQL 用声明式语言描述“要什么”，查询优化器决定“如何做”。

**怎么做**
```sql
SELECT dept, COUNT(*) AS n
FROM employee
WHERE salary >= 5000
GROUP BY dept
HAVING COUNT(*) >= 3
ORDER BY n DESC;
```
- 逻辑处理顺序：`FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT`（简化描述）。
- `WHERE` 过滤行，`HAVING` 过滤组；`COUNT(*)` 数行，`COUNT(col)` 不计 NULL；`DISTINCT` 去重。
- `INNER JOIN` 匹配两边；`LEFT JOIN` 保留左表未匹配行并填 NULL。
- 子查询 `IN/EXISTS`；“对所有”可用双重 `NOT EXISTS`。
- `NULL` 用 `IS NULL`，与 NULL 的一般比较结果是 UNKNOWN；三值逻辑会影响过滤。
- DDL `CREATE/ALTER/DROP`；DML `INSERT/UPDATE/DELETE`；授权 `GRANT/REVOKE`；约束 `PRIMARY KEY/FOREIGN KEY/UNIQUE/CHECK/NOT NULL`。
- 索引 B+ 树利于范围过滤、排序；联合索引常涉及最左前缀匹配，但实际取决于数据库优化器与索引机制。

**易错**：`WHERE COUNT(*)` 无效；外连接后把右表过滤条件写入 WHERE 可能意外丢掉 NULL 行。

## 专项解题

### E2. SQL 的典型坑

```sql
-- 查询每个部门中工资大于等于 5000 的员工数，至少 3 人
SELECT dept_id, COUNT(*) AS cnt
FROM employee
WHERE salary >= 5000
GROUP BY dept_id
HAVING COUNT(*) >= 3;
```

`WHERE` 在分组前筛选，`HAVING` 在分组后筛选。`COUNT(*)` 算行数、`COUNT(column)` 排除 NULL。`LEFT JOIN` 右表非匹配行填 NULL，因此 `WHERE right.col=1` 会排除这些 NULL 行（往往使查询像内连接），需要条件放 `ON` 或显式处理 NULL。
