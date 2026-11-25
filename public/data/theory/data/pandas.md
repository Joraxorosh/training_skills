pandas — основной инструмент аналитика в Python для табличных данных, NumPy — его вычислительное ядро. На собеседовании дают короткие сниппеты «что выведет» и задачи на группировку, слияние и пропуски. Ключ к успеху — понимать индексы, оси, векторизацию и то, когда pandas возвращает копию.

## Series, DataFrame и индексация

**Series** — одномерный массив с индексом, **DataFrame** — таблица из Series-столбцов с общим индексом. `df['a']` возвращает Series, `df[['a']]` — DataFrame.

- `loc` — выбор по **меткам**, срез включает правую границу.
- `iloc` — выбор по **позициям**, срез как в Python, правая граница не включается.

```python
s = pd.Series([10, 20, 30], index=[2, 0, 1])
s.loc[0], s.iloc[0]          # (20, 10)

s = pd.Series([1, 2, 3, 4], index=list('abcd'))
s.loc['a':'c'].sum()         # 6 — 'c' включена
s.iloc[0:2].sum()            # 3 — позиция 2 не включена
```

**Булева индексация**: условия объединяют `&`, `|`, `~`, каждое в скобках. `and`/`or` вызовут `ValueError: The truth value of a Series is ambiguous`.

```python
df[(df.a > 1) & (df.b > 1)]
df.loc[df.city.isin(['M', 'S']), ['user', 'revenue']]
df.query('a > 1 and b > 1')
```

**Оси**: `axis=0` — операция идёт вдоль строк, результат по столбцам (`df.mean()` — среднее каждого столбца); `axis=1` — результат по строкам.

## groupby, agg и transform

```python
df.groupby('city')['revenue'].sum()                     # Series по группам
df.groupby('city').agg(users=('user', 'nunique'),
                       revenue=('revenue', 'sum'))      # именованные агрегаты
df['share'] = df.revenue / df.groupby('city').revenue.transform('sum')
```

- `agg` возвращает строку на группу.
- `transform` возвращает результат той же длины, что исходные данные: удобно для долей и нормализации внутри группы.
- `filter` оставляет группы целиком по условию.

По умолчанию строки с NaN в ключе группировки выбрасываются; чтобы их сохранить — `groupby('g', dropna=False)`.

## merge, pivot_table и melt

| how | Что остаётся |
|---|---|
| `inner` | Ключи из обеих таблиц |
| `left` | Все строки левой + совпадения справа |
| `right` | Все строки правой + совпадения слева |
| `outer` | Все ключи обеих таблиц |
| `cross` | Декартово произведение |

Дубликаты ключа справа размножают строки левой таблицы — частая причина «раздувания» выручки. Защита — `validate='many_to_one'` (выбросит `MergeError`) и `indicator=True` для отладки.

```python
p = df.pivot_table(index='city', columns='month', values='rev',
                   aggfunc='sum', fill_value=0)       # long → wide
long = p.reset_index().melt(id_vars='city',
                            var_name='month', value_name='rev')  # wide → long
```

`pivot` не умеет агрегировать и падает на дубликатах, `pivot_table` агрегирует.

## Пропуски и типы данных

- `isna()` / `notna()` — проверка пропусков. `s == np.nan` всегда False: NaN не равен даже себе.
- Агрегаты пропускают NaN (`skipna=True`), `count()` считает непустые, `len()` — все строки.
- `dropna(subset=[...])` удаляет строки, `fillna({'age': med})` заполняет по столбцам, `ffill()` — предыдущим значением.
- Целые с NaN превращаются в `float64`; сохранить целые помогает nullable-тип `Int64`.
- `category` для строк с малым числом уникальных значений экономит память и ускоряет groupby.
- `pd.to_datetime`, `pd.to_numeric(errors='coerce')` приводят типы при загрузке.

## Даты и временные ряды

```python
df['ts'] = pd.to_datetime(df['ts'])
df['day'] = df.ts.dt.date
df['dow'] = df.ts.dt.dayofweek          # 0 = понедельник
daily = df.set_index('ts').resample('D')['revenue'].sum()
weekly = daily.resample('W').sum()      # недели до воскресенья (W-SUN)
rolling7 = daily.rolling(7).mean()
```

`resample` требует DatetimeIndex (или параметр `on=`). Для сдвигов — `shift(1)`, для прироста — `pct_change()`.

## Векторизация и NumPy

`apply` с `axis=1` вызывает Python-функцию для каждой строки и на больших данных медленнее векторных операций в десятки-сотни раз.

```python
df['total'] = df.price * df.qty                        # векторно
df['flag'] = np.where(df.total > 1000, 'big', 'small') # условие
df['bucket'] = pd.cut(df.total, bins=[0, 500, 1000, np.inf])
```

**Broadcasting** в NumPy: формы сравниваются справа налево, размерности совместимы, если равны или одна из них 1.

```python
a = np.arange(3).reshape(3, 1)   # (3, 1)
b = np.arange(4)                 # (4,)
(a + b).shape                    # (3, 4)
np.ones((3, 2)) + np.ones(3)     # ValueError
```

## SettingWithCopy и copy-on-write

Цепочечное присваивание `df[df.a > 1]['b'] = 9` меняет временный объект, а не df. Раньше pandas выдавал `SettingWithCopyWarning`; в pandas 3 включён copy-on-write, и такая запись гарантированно не изменит исходный df. Правильно — одним `loc`:

```python
df.loc[df.a > 1, 'b'] = 9
sub = df[df.a > 1].copy()        # явная копия для дальнейшей работы
```

## Частые вопросы на собеседовании

- Чем `loc` отличается от `iloc`? → Метки против позиций; срез `loc` включает правую границу.
- Чем `transform` отличается от `agg`? → `transform` сохраняет длину исходных данных.
- Почему после merge стало больше строк? → Дубликаты ключа в правой таблице.
- Почему int стал float? → NaN — значение float; используйте `Int64`.
- Почему `apply` медленный? → Python-цикл по строкам вместо векторных операций.
- Как избежать SettingWithCopy? → Присваивать через `df.loc[mask, col]`, при необходимости `.copy()`.

## Шпаргалка

| Задача | Код |
|---|---|
| Выбор по метке / позиции | `loc` / `iloc` |
| Несколько условий | `(c1) & (c2)` |
| Агрегат на группу | `groupby().agg()` |
| Агрегат на строку | `groupby().transform()` |
| Широкая таблица | `pivot_table` |
| Длинная таблица | `melt` |
| Пропуски | `isna`, `fillna`, `dropna` |
| Группа NaN | `groupby(..., dropna=False)` |
| Даты | `pd.to_datetime`, `.dt`, `resample` |
| Условие векторно | `np.where` |
| Присваивание по маске | `df.loc[mask, col] = v` |
