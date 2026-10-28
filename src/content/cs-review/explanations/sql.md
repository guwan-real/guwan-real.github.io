---
knowledgeId: sql
description: 用真实小表逐步执行筛选、连接、分组、子查询，理解 NULL、计数与 SQL 约束。
updatedAt: "2026-10-28"
sources:
  - label: PostgreSQL 18 官方文档：表表达式与连接、分组
    url: https://www.postgresql.org/docs/18/queries-table-expressions.html
  - label: PostgreSQL 18 官方文档：比较与 NULL
    url: https://www.postgresql.org/docs/18/functions-comparison.html
  - label: PostgreSQL 18 官方文档：聚合函数
    url: https://www.postgresql.org/docs/18/functions-aggregate.html
  - label: PostgreSQL 18 官方文档：子查询表达式
    url: https://www.postgresql.org/docs/18/functions-subquery.html
  - label: PostgreSQL 18 官方文档：SELECT
    url: https://www.postgresql.org/docs/18/sql-select.html
  - label: PostgreSQL 18 官方文档：标量子查询与值表达式
    url: https://www.postgresql.org/docs/18/sql-expressions.html
  - label: PostgreSQL 18 官方文档：视图更新与检查选项
    url: https://www.postgresql.org/docs/18/sql-createview.html
  - label: PostgreSQL 18 官方文档：C 中的嵌入式 SQL
    url: https://www.postgresql.org/docs/18/ecpg-concept.html
---

## SQL 要先读懂结果，再背语法

SQL 是声明式语言，主要描述“需要哪些数据”，数据库决定怎样执行。读一道 SQL 题时，最可靠的方法是把每一步的中间表写出来；只背“WHERE 在 HAVING 前面”还不足以判断最终结果。

以下采用常见标准 SQL 写法，少数示例明确使用 PostgreSQL 语法。表名、人物与数据全部自编。没有 `ORDER BY` 时，结果行的显示顺序不作保证；下文按便于阅读的顺序列出结果，不代表数据库天然按学号排序。

## 先固定本章使用的三张小表

院系表 `Department`：

| dept_id | dept_name |
| --- | --- |
| D10 | 计算机 |
| D20 | 通信 |
| D30 | 自动化 |

学生表 `Student`：

| sid | name | dept_id |
| --- | --- | --- |
| S1 | 安禾 | D10 |
| S2 | 柏青 | D10 |
| S3 | 晨星 | D20 |
| S4 | 冬雨 | NULL |

选课表 `Enrollment`：

| sid | cid | score |
| --- | --- | --- |
| S1 | C1 | 90 |
| S1 | C2 | NULL |
| S2 | C1 | 70 |
| S2 | C2 | 80 |
| S3 | C1 | 60 |
| S3 | C2 | NULL |

约定 `(sid,cid)` 是选课表的主键；NULL 成绩表示尚未录入，不是零分。S4 尚无选课，D30 尚无学生。这两处“空缺”是理解外连接和计数的关键。

## SELECT、WHERE 与 DISTINCT 各处理什么

查询计算机院系的学生姓名：

```sql
SELECT name
FROM Student
WHERE dept_id = 'D10';
```

先从 Student 取行，再用 WHERE 留下 S1、S2，最后 SELECT 输出 name 列，得到安禾、柏青。

若查询 `SELECT dept_id FROM Student`，D10 会出现两次。SQL 默认没有自动去重；写成 `SELECT DISTINCT dept_id FROM Student` 才会把两个 D10 合为一个结果。投影哪些列与是否去重是两个决定，不能把它们混为一谈。

条件可用 `AND`、`OR`、`NOT` 组合。例如 `score >= 60 AND score < 80` 留下 60、70。`BETWEEN 60 AND 80` 包含两个端点，会包括 80。复杂条件最好加括号，明确“属于指定院系且满足两种成绩条件之一”的范围。

## NULL 带来三值逻辑

SQL 中一般比较遇到 NULL，会得到 UNKNOWN，而不是普通的 TRUE 或 FALSE。例如：

| 表达式 | 结果 |
| --- | --- |
| `90 >= 80` | TRUE |
| `70 >= 80` | FALSE |
| `NULL >= 80` | UNKNOWN |
| `NULL = NULL` | UNKNOWN |
| `NULL IS NULL` | TRUE |

WHERE **只保留条件为 TRUE 的行**。因此 `WHERE score >= 80` 留下 S1-C1 和 S2-C2，NULL 成绩不会留下；`WHERE NOT (score >= 80)` 也不会留下 NULL，因为 NOT UNKNOWN 仍是 UNKNOWN。

要找未录入成绩，应写 `WHERE score IS NULL`，不能写 `score = NULL`。要表达“低于 80 分或尚未录入”，应写：

```sql
WHERE score < 80 OR score IS NULL
```

常见组合规律是 `TRUE OR UNKNOWN = TRUE`、`FALSE AND UNKNOWN = FALSE`；如果没有这样的确定分支，结果可能仍未知。[官方比较文档](https://www.postgresql.org/docs/18/functions-comparison.html)解释了 NULL 判断的专用谓词。

`COALESCE(score, 0)` 可以在表达式中把 NULL 替换为 0，但这同时引入了“未录入按零分处理”的业务选择。不能为了让计算方便，就悄悄改变缺失值的含义。

## 聚合函数：数行、数非空值、算平均并不相同

对全部 Enrollment 执行：

```sql
SELECT COUNT(*) AS row_n,
       COUNT(score) AS scored_n,
       AVG(score) AS avg_score
FROM Enrollment;
```

得到 row_n=6、scored_n=4、avg_score=75，因为有效成绩为 90、70、80、60，总和 300，除以 4。

| 函数 | 本例含义 |
| --- | --- |
| `COUNT(*)` | 数输入行，NULL 行内值不影响计数 |
| `COUNT(score)` | 只数 score 非 NULL 的行 |
| `COUNT(DISTINCT sid)` | 数不同的非 NULL 学号 |
| `SUM(score)`、`AVG(score)` | 对非 NULL 成绩求和、平均 |

在没有输入行且没有 GROUP BY 的整体聚合中，COUNT 返回 0，SUM、AVG 通常返回 NULL。平均分的分母不是永远等于 `COUNT(*)`。[官方聚合函数文档](https://www.postgresql.org/docs/18/functions-aggregate.html)可核对这些细节。

## GROUP BY 与 HAVING：按中间结果逐步算

题目要求：“找出已有至少两门及格成绩的学生，给出及格门数与这些成绩的平均分。”

```sql
SELECT sid, COUNT(*) AS passed_n, AVG(score) AS avg_score
FROM Enrollment
WHERE score >= 60
GROUP BY sid
HAVING COUNT(*) >= 2
ORDER BY avg_score DESC, sid ASC;
```

按教学用的逻辑处理顺序推演：

1. **FROM**：输入原来的 6 行选课。
2. **WHERE**：只留下成绩为 90、70、80、60 的 4 行，两条 NULL 成绩被排除。
3. **GROUP BY sid**：把 4 行分成三组：S1={90}，S2={70,80}，S3={60}。
4. **HAVING**：检查每组的 `COUNT(*)>=2`，只有 S2 通过。
5. **SELECT**：输出 S2、2、75。
6. **ORDER BY**：对最终结果排序；本例只有一行。

WHERE 过滤的是分组前的行，HAVING 过滤的是组。`WHERE COUNT(*) >= 2` 不能用来表达这个条件，因为该阶段还没有这些分组计数。常用逻辑顺序可记为 `FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → 分页`，它帮助解释语义，不是承诺数据库物理上按同样步骤逐行运行。[SELECT 文档](https://www.postgresql.org/docs/18/sql-select.html)描述了查询处理的相关规则。

分组查询中，SELECT 的非聚合列通常应出现在分组列中，或满足 DBMS 支持的函数依赖规则。写 `GROUP BY sid` 却随意 SELECT 某条选课的 cid，无法解释该组有两门课时究竟输出哪一个 cid。

分组键含 NULL 时，GROUP BY 可以把这些 NULL 放进同一组；这不意味着普通比较 `NULL=NULL` 变成了 TRUE。分组、去重与比较各有语义，不能把 WHERE 中的三值比较规则机械替换成“所有 NULL 永远不能归在一起”。

## JOIN：先判断一行会匹配多少行

内连接按 ON 条件保留匹配组合：

```sql
SELECT s.sid, s.name, e.cid, e.score
FROM Student AS s
JOIN Enrollment AS e ON e.sid = s.sid;
```

S1 匹配两门课，S2 两门，S3 两门，S4 没有匹配，因此共 6 行。JOIN 不保证“左表一行只变成一行”。如果忽略一对多联系，后续人数、金额就可能被重复计算。

把 JOIN 改成 LEFT JOIN，则保留全部左表学生。S4 会得到一行：`S4、冬雨、NULL、NULL`，总计 7 行。注意这是外连接补出的行，与真实存在但 score 为 NULL 的选课行不同。

现在要求“列出所有学生及其 C1 成绩，没有 C1 也要列出”：

```sql
SELECT s.sid, e.score
FROM Student AS s
LEFT JOIN Enrollment AS e
  ON e.sid = s.sid AND e.cid = 'C1';
```

输出为 `(S1,90),(S2,70),(S3,60),(S4,NULL)`。ON 中的条件决定哪些右表行能够匹配；没有匹配时，LEFT JOIN 仍会补出左行。

若把 `e.cid='C1'` 移到 WHERE：

```sql
FROM Student AS s
LEFT JOIN Enrollment AS e ON e.sid = s.sid
WHERE e.cid = 'C1'
```

S4 补出的 e.cid 为 NULL，比较结果是 UNKNOWN，被 WHERE 删掉，结果只剩 3 行。移动条件改变了查询含义。[官方表表达式文档](https://www.postgresql.org/docs/18/queries-table-expressions.html)分别解释了连接和后续过滤的作用。

## 外连接后统计零，也要选对计数对象

要求“每个院系的学生人数，零人院系也要显示”：

```sql
SELECT d.dept_id, COUNT(s.sid) AS student_n
FROM Department AS d
LEFT JOIN Student AS s ON s.dept_id = d.dept_id
GROUP BY d.dept_id
ORDER BY d.dept_id;
```

结果 D10=2、D20=1、D30=0。D30 经过外连接后仍有一行，只是 s 的各列全为 NULL；因此 `COUNT(*)` 会把这行数成 1，而 `COUNT(s.sid)` 得到 0。这里选择右表非空主键计数，表示“真实匹配到的学生数”。

S4 没有院系，不会自动组成某个已存在院系的成员。若需求还要统计“未分配院系”，必须明确增加相应分组逻辑，不能期待外连接替业务决定。

## 子查询：IN 比值，EXISTS 看是否有行

`IN` 用于判断一个值是否出现在子查询结果中；`EXISTS` 只关心子查询有没有至少一行返回。相关子查询还会引用外层当前行。

例如找没有选课的学生：

```sql
SELECT s.sid, s.name
FROM Student AS s
WHERE NOT EXISTS (
  SELECT 1
  FROM Enrollment AS e
  WHERE e.sid = s.sid
);
```

把外层学生逐个代入：S1 有匹配，所以 NOT EXISTS 为假；S2、S3 也有；S4 没有，所以结果为 S4。`SELECT 1` 只是表达“存在一行即可”，不是要求表中某列的值必须为 1。

NULL 会让 `NOT IN` 出现特别容易错的结果。假设查询没有学生的院系：

```sql
SELECT d.dept_id
FROM Department AS d
WHERE d.dept_id NOT IN (SELECT dept_id FROM Student);
```

子查询含 D10、D10、D20、NULL。对 D30，需要确认它既不等于 D10、也不等于 D20、也不等于 NULL；最后一项未知，所以整体不会为 TRUE，D30 也被排除。可以改为相关 `NOT EXISTS`：检查是否不存在 `s.dept_id=d.dept_id` 的学生，正确得到 D30。不要概括成“IN 永远慢、EXISTS 永远快”；执行效率依计划和数据而定。[子查询文档](https://www.postgresql.org/docs/18/functions-subquery.html)解释了 NULL 对 IN/NOT IN 的影响。

## “满足所有要求”为什么可以用两次不存在

要求所有学生中“C1、C2 都已及格”的人，可翻译成：**不存在一门要求课，使该学生不存在一条及格记录。**

假设另有 `RequiredCourse(cid)`，只有 C1、C2 两行：

```sql
SELECT s.sid
FROM Student AS s
WHERE NOT EXISTS (
  SELECT 1
  FROM RequiredCourse AS r
  WHERE NOT EXISTS (
    SELECT 1
    FROM Enrollment AS e
    WHERE e.sid = s.sid
      AND e.cid = r.cid
      AND e.score >= 60
  )
);
```

逐人找“反例课程”：S1 的 C2 未录入，找到了反例；S2 两门都有及格记录，没有反例；S3 的 C2 是反例；S4 两门都缺。最终只有 S2。

若只要求“选过所有要求课”，删去 `score>=60`，则 S1、S2、S3 都满足。题干中的“选过”“有成绩”“及格”是三种不同条件。若要求课程集合为空，这种逻辑会让所有学生通过，因为找不到任何反例课程；是否符合产品需求，需要额外约定。

## 对比两种需求，避免把 WHERE 与 HAVING 互换

“找至少有两条选课记录的学生，再计算其平均分”与“找至少有两门及格成绩的学生”不是同一个需求。前者应先让全部选课参与分组，后者才先过滤不及格与未录入成绩。

例如去掉前面分组查询中的 `WHERE score>=60`，S1、S2、S3 每人都有两条选课记录，都会通过 `HAVING COUNT(*)>=2`，平均分分别为 90、75、60。平均函数忽略 NULL，并不改变 COUNT(*) 对行的计数。这说明“平均分有值”不意味着两条记录都有成绩。

若需求改成“至少有两门已录入成绩”，可以用 `HAVING COUNT(score)>=2`，本章只有 S2 通过。若写 `HAVING AVG(score)>=80`，则是选择平均分达到门槛的组；它并不保证每一门课都达到 80 分，也不保证每门都已录入。应把题目的量词和对象逐一翻译，不能只凭句中出现“至少”就固定使用 COUNT(*)。

## 子查询还要判断输出是一值、一列还是一张表

“子查询”只是查询嵌套的形式，它所在的位置决定期望的结果形状。用于 `score > (...)` 右侧的标量子查询应给出单个值；用于 IN 的子查询通常给出一列候选值；FROM 中的派生表则可以有多行多列。

例如找高于全部已录入成绩平均分的记录：

```sql
SELECT sid, cid, score
FROM Enrollment
WHERE score > (SELECT AVG(score) FROM Enrollment);
```

先理解内部整体平均为 75，再筛外层，留下 90 和 80 对应的两行。这个子查询没有引用外层当前学生，表示全体平均；若改成按外层 sid 计算各学生平均，含义就变成“高于本人平均”。

标量子查询若返回多行，通常会报错，不能想当然地取第一行。要取确定的一条记录，应写清筛选和排序规则。相关子查询也不意味着数据库物理上一定为每一行完整执行一次，优化器可能改写；做结果题先关注语义，性能再看计划。

## 多个一对多连接会放大计数

设 S1 有 2 条选课，另一个 Award 表中又有 3 条获奖。把 Student、Enrollment、Award 直接按学号连接，S1 可能产生 2×3=6 个组合：每条选课分别与每条获奖配对。

这时 `COUNT(*)` 得到 6，不能解释成“选了六门课”，成绩也被重复三次。即使本例重复倍数恰好一致，使 AVG 看起来没有变化，人数与总分仍可能错；换一组连接或不同匹配数量，还可能形成更隐蔽的偏差。

解决前先明确统计单位：数学生可以考虑不同学生标识，数课程要核对选课键，汇总成绩时可以先把 Enrollment 按学生聚合，再与其他结果连接。不要看到重复就随手给整条 SELECT 加 DISTINCT，因为不同组合可能本来就不同，DISTINCT 也不能一般性修复已经算错的 SUM。

## 去重、排序与分页的边界

`UNION` 合并相容的结果并去重，`UNION ALL` 保留所有输入行。它们是否能替换，取决于业务是否需要保留重复，而不只是语法长短。

分页应有确定排序。例如两人成绩都为 80，仅按 score 排序时，二人的先后可能不稳定；需要稳定展示时可补学号等唯一的次排序键。排序只是返回结果的展示规则，不会把基表从此永久按那个顺序保存。

## 修改、建表和约束也属于 SQL 基础

常见分类包括 DDL 的 CREATE、ALTER、DROP，数据操作的 INSERT、UPDATE、DELETE、SELECT，以及授权 GRANT、REVOKE、事务控制 COMMIT、ROLLBACK。教材对 SELECT 是否单独称 DQL 的分类不尽相同，重点是认清操作作用。

例如选课表可以有以下核心约束：

```sql
CREATE TABLE Enrollment (
  sid VARCHAR(20) NOT NULL REFERENCES Student(sid),
  cid VARCHAR(20) NOT NULL REFERENCES Course(cid),
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  PRIMARY KEY (sid, cid)
);
```

这里假定 Student、Course 已建好且被引用列有适当唯一约束。主键防重复选课；外键防引用不存在的学生、课程；CHECK 限定已录入成绩范围，但仍允许 score 为 NULL。如果业务要求必须录入成绩，还要增加 NOT NULL。

`UPDATE Enrollment SET score=score+5 WHERE cid='C1'` 更新匹配行；缺少 WHERE 可能更新全部行。NULL 加 5 仍为 NULL。DELETE 删除行，DROP TABLE 删除表结构及其数据，两者不能互换。

索引是访问路径，会影响性能，不应改变正确查询的逻辑结果。某个查询有没有使用索引、是否有大量重复连接，可借助执行计划观察；不能仅凭“有 WHERE”就断言一定用了索引。

## 补充：查询优化要保持语义，不能只背运算顺序

对内连接，如果筛选条件只引用 Student 的院系列，可以先留下该院系学生，再与选课连接，通常能减少后续处理的中间行。假设一万名学生只有一百名属于 D10，先筛这一百名再连接，比先构造所有学生的关联结果更有机会省工作；实际效率仍由数据分布、索引和执行计划决定。

尽早投影也可能减少中间结果宽度，但必须保留之后还需要的列。例如先留下 sid、name，再按 sid 连接可以；若把 sid 提前丢掉，后面就无法进行原连接。需要 GROUP BY、过滤和排序的列也不能无依据地删除。

这类等价变换有条件。前文已说明 LEFT JOIN 的右表过滤条件在 ON、WHERE 中含义可能不同，所以不能把“尽量下推选择”理解成“任何条件都能随意搬”。所谓先选择、再投影是入门优化线索，不是所有 DBMS 的固定物理运行顺序。

## 补充：视图的 WITH CHECK OPTION 检查更新后的可见性

假设 Staff(id,branch) 上有一个简单可更新视图：

```sql
CREATE VIEW EastStaff AS
SELECT id, branch FROM Staff
WHERE branch = 'E'
WITH CHECK OPTION;
```

视图只显示 E 分部。若权限与其他约束均允许，通过视图把某人从 E 改为 W，会让更新后的行不再满足视图条件，因此检查选项拒绝它；通过视图插入 branch='W' 的新行，也会被拒绝。

但 CHECK OPTION 不是“禁止删除”：删除当前可见的行，没有生成一条不满足条件的新行，不能仅凭这个选项断言删除一定失败。它也不让所有聚合、分组或多表视图自动变成可更新视图。[官方视图文档](https://www.postgresql.org/docs/18/sql-createview.html)说明了适用范围。

## 补充：标量、聚合与子查询的结果形状

`ABS(x)` 对一个数取绝对值，`MAX(x)`、`SUM(x)`、`AVG(x)` 把一组输入汇总。对 x 为 -4、3、8 的三行，单独选择 ABS(x) 得到 4、3、8 三行；不分组的 MAX(x) 得到一行 8。不要因为函数都写在 SELECT 里，就把所有函数都称为聚合函数。

标量子查询放在需要一个值的位置，要分别考虑三种情况：返回一行一列，使用该值；返回零行，标量结果为 NULL；返回多行，通常是错误，不能擅自取第一行。若用“产品名称”查价格，先确认该名称是否唯一；用 MIN 或 MAX 把多行压成一值，会引入新的业务选择，不能无声地当成等价修复。[官方值表达式文档](https://www.postgresql.org/docs/18/sql-expressions.html)可核对这些规则。

SQL 约束声明也要逐项读。例如 `staff_no INTEGER NOT NULL UNIQUE` 要求非空、唯一且符合整数类型，却没有自动把该列声明成 PRIMARY KEY。一个表可以有多个唯一约束；主键是明确选定的一组标识。要判“已声明主键”，应看 PRIMARY KEY 声明，不能只凭非空唯一就替数据库补写。

## 补充：交互式 SQL 与嵌入式 SQL

在查询工具输入 SQL 并查看结果，是交互式使用。传统嵌入式 SQL 则把带专用标记的 SQL 放在宿主语言中，由预处理和编译过程连接两种语言。例如 C 的 ECPG 形式可以写 `EXEC SQL SELECT name INTO :name FROM Staff WHERE id=:id;`，冒号标记宿主变量，程序借此传入条件、接收结果。

SQL 结果可能有多行，宿主程序往往需要游标或相应结果遍历机制逐行处理。现代应用也常通过驱动和参数接口执行 SQL，这与传统预处理式嵌入 SQL 有共同的应用访问目的，但不必把每种接口都说成同一种编译方式。使用方式变化，不会把 SQL 变成某一个厂商的专有查询语言。[ECPG 官方概念说明](https://www.postgresql.org/docs/18/ecpg-concept.html)展示了预处理式嵌入的流程。

## 做题顺序与自查

SQL 结果题建议在纸上依次写：输入行 → 连接匹配数 → WHERE 保留行 → 分组内容 → HAVING 保留组 → SELECT 输出 → 去重排序。专门圈出 NULL、重复行、外连接未匹配行，计数时明确数的是行、非空值还是不同对象。

自查：

1. 本章 Enrollment 中 `COUNT(*)` 与 `COUNT(score)` 分别是多少？**6 与 4。**
2. LEFT JOIN 保留了 S4，后面就绝不会丢掉它吗？**会；WHERE 仍可能排除它。**
3. `AVG(score)` 会把未录入成绩自动当作 0 吗？**不会，通常忽略 NULL 输入。**
4. “两门都及格”和“至少一门及格”能用同一个条件替代吗？**不能；前者需要排除任何未满足的要求。**
