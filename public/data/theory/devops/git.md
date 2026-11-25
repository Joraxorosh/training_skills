Git — распределённая система контроля версий. Для DevOps это не только «хранилище кода», но и источник правды для пайплайнов, инфраструктуры (IaC) и GitOps. На собеседовании проверяют понимание трёх областей (рабочая директория, индекс, репозиторий), разницу merge/rebase, способы безопасно откатывать изменения и восстанавливать «потерянные» коммиты.

## Три области и базовые команды

- **Рабочая директория** — файлы на диске.
- **Индекс (staging area)** — снимок того, что войдёт в следующий коммит. `git add` добавляет текущее состояние файла в индекс.
- **Репозиторий** — граф коммитов в `.git`.

```bash
git status
git diff            # рабочая директория vs индекс (ещё не добавлено)
git diff --staged   # индекс vs последний коммит
git add file && git commit -m "msg"
git log --oneline --graph --all
```

**HEAD** — указатель на текущую позицию: обычно на ветку (которая указывает на коммит). Detached HEAD — HEAD указывает прямо на коммит, а не на ветку.

## Ветки и работа с удалённым репозиторием

```bash
git switch -c feature        # создать и переключиться (новый способ)
git checkout -b feature      # то же, классический способ
git fetch origin             # скачать изменения, ничего не сливая
git pull                     # fetch + merge (или rebase при pull.rebase=true)
git push -u origin feature
```

| Команда | Что делает |
|---|---|
| `git fetch` | Обновляет remote-tracking ветки (`origin/main`), рабочую копию не трогает |
| `git pull` | fetch + интеграция в текущую ветку |
| `git push --force` | Перезаписывает удалённую ветку безусловно |
| `git push --force-with-lease` | Перезаписывает, только если удалённая ветка не изменилась с момента вашего fetch |

## Merge, rebase, squash, cherry-pick

**Fast-forward** происходит, когда текущая ветка — предок сливаемой (в main не было новых коммитов). Git просто передвигает указатель, merge-коммит не создаётся. `--no-ff` заставляет создать merge-коммит.

`git rebase main`, находясь на feature, переносит коммиты feature поверх последнего коммита main — история становится линейной, но **хеши коммитов меняются**. Поэтому нельзя ребейзить ветку, которую уже запушили и с которой работают другие: у коллег окажется расходящаяся история.

```bash
git rebase -i HEAD~5         # pick, reword, edit, squash, fixup, drop, переупорядочить
git merge --squash feature   # все изменения feature в индекс одним набором; коммит делаете сами
git cherry-pick a1b2c3d      # применить один коммит в текущую ветку
```

## Отмена изменений

| Команда | Ветка/HEAD | Индекс | Рабочая директория |
|---|---|---|---|
| `git reset --soft HEAD~1` | откат на 1 коммит | изменения остаются в индексе | не трогает |
| `git reset --mixed HEAD~1` (по умолчанию) | откат | сброшен | изменения остаются |
| `git reset --hard HEAD~1` | откат | сброшен | изменения удалены |
| `git revert <sha>` | новый коммит, отменяющий указанный | — | — |

> Для коммита, который уже запушен в общую ветку, используют **git revert**: он не переписывает историю. reset + force push ломает работу коллег.

`git restore file` отменяет изменения в рабочей директории, `git restore --staged file` убирает файл из индекса.

## reflog и bisect

**reflog** — локальный журнал перемещений HEAD и веток (хранится около 90 дней, не отправляется на сервер). Спасает после `reset --hard` или неудачного rebase:

```bash
git reflog
git reset --hard HEAD@{2}     # или git branch rescue <sha>
```

**git bisect** — бинарный поиск коммита, внёсшего баг:

```bash
git bisect start
git bisect bad              # текущий коммит плохой
git bisect good v1.2.0      # этот был хорошим
git bisect run ./test.sh    # автоматически
git bisect reset
```

## stash, .gitignore, сабмодули, хуки

```bash
git stash            # спрятать незакоммиченные изменения (-u — с неотслеживаемыми)
git stash pop        # применить и удалить из стека
git stash apply      # применить, оставив в стеке
git rm --cached config.env   # перестать отслеживать, оставив файл на диске
git clone --recurse-submodules URL
git submodule update --init --recursive
```

`.gitignore` действует только на **неотслеживаемые** файлы. Если файл уже закоммичен, добавление в `.gitignore` ничего не изменит — нужно `git rm --cached`. А если там был секрет, его надо считать скомпрометированным и ротировать: он остался в истории.

Хуки лежат в `.git/hooks` (можно сменить через `core.hooksPath`). Они **не передаются при clone** и выполняются локально, поэтому клиентские хуки (pre-commit, commit-msg) — удобство, а не гарантия; обязательные проверки делают в CI или серверных хуках (pre-receive).

## Модели ветвления

- **GitFlow**: `main`, `develop`, `feature/*` от develop, `release/*` от develop, `hotfix/*` **от main** (и вливаются в main и develop).
- **GitHub Flow**: main + короткие feature-ветки через PR.
- **Trunk-based**: все коммитят в trunk часто, недоделанное прячут за feature flags. Лучше всего сочетается с CI/CD.

## Частые вопросы на собеседовании

- fetch vs pull? → fetch только скачивает, pull ещё и сливает.
- Как отменить запушенный коммит? → `git revert`, не reset.
- Как найти коммит после `reset --hard`? → `git reflog`, затем reset/branch на найденный sha.
- merge vs rebase? → merge сохраняет историю и добавляет merge-коммит; rebase делает историю линейной, переписывая коммиты.
- Почему `--force-with-lease` безопаснее? → Не затрёт чужие коммиты, появившиеся на сервере после вашего fetch.
- stash pop vs apply? → pop удаляет запись из стека, apply — нет.

## Шпаргалка

- `git switch -c b`, `git checkout -b b`, `git branch -d b`
- `git diff`, `git diff --staged`, `git log --oneline --graph`
- `git reset --soft|--mixed|--hard`, `git revert sha`, `git restore`
- `git rebase main`, `git rebase -i HEAD~N`, `git cherry-pick sha`
- `git merge --no-ff`, `git merge --squash`
- `git reflog`, `git bisect start/good/bad/reset`
- `git stash`, `pop`, `apply`, `list`
- `git rm --cached f`, `git push --force-with-lease`
