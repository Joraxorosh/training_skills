В Git очень трудно потерять закоммиченные данные и очень легко потерять незакоммиченные. Почти любую ошибку можно отменить, если понимать, какая команда что трогает: ветку, индекс или рабочую директорию, и переписывает ли она историю. На собеседовании любят ситуационные вопросы: «запушили секрет», «сделали reset --hard», «нужно отменить merge».

## reset, revert и amend

`git reset` двигает текущую ветку на другой коммит и, в зависимости от режима, сбрасывает индекс и рабочую директорию:

| Режим | Ветка | Индекс | Рабочая директория |
|---|---|---|---|
| `--soft` | двигается | не трогается (изменения staged) | не трогается |
| `--mixed` (по умолчанию) | двигается | сбрасывается | не трогается |
| `--hard` | двигается | сбрасывается | сбрасывается — правки теряются |

`git reset file` (без режима) только убирает файл из индекса. `git revert <sha>` создаёт **новый** коммит с обратными изменениями и не переписывает историю — это способ отмены для общих веток. Для merge-коммита нужно указать основного родителя: `git revert -m 1 <merge>`.

> Ловушка: после revert merge-а повторное слияние той же ветки принесёт только новые коммиты — старые Git считает уже слитыми. Чтобы вернуть их, делают revert самого revert-коммита.

`git commit --amend` заменяет последний коммит новым (новый хеш): `git add forgotten.txt && git commit --amend --no-edit`. Если коммит уже запушен, понадобится force-push.

## restore, switch и checkout

Исторически `checkout` делал всё: переключал ветки и восстанавливал файлы. С Git 2.23 обязанности разделены:

```bash
git switch feature            # переключить ветку
git switch -c feature         # создать и переключить
git switch --detach HEAD~2    # явный detached HEAD
git restore app.py            # отменить правки в рабочей директории
git restore --staged app.py   # убрать из индекса, правки сохранить
git restore --source=HEAD~2 app.py   # взять версию из коммита (только worktree)
git checkout HEAD~2 -- app.py        # то же, но обновит ещё и индекс
```

## stash и clean

```bash
git stash                 # только отслеживаемые файлы
git stash -u              # плюс неотслеживаемые
git stash list
git stash apply stash@{1} # применить, запись остаётся
git stash pop             # применить и удалить запись
git stash pop --index     # восстановить и состояние индекса
```

Если `pop` завершился конфликтом, запись **не удаляется** — после разрешения удалите её вручную `git stash drop`. Обычный `pop` не восстанавливает, что было в индексе, — для этого `--index`.

`git clean` удаляет неотслеживаемые файлы: сначала всегда `git clean -n` (dry run), затем `-f`, `-fd` (с каталогами), `-x` (и игнорируемые).

## Восстановление через reflog

Reflog помнит каждое перемещение HEAD, поэтому «потерянные» коммиты почти всегда находятся:

```bash
git reset --hard HEAD~3        # ой
git reflog
# aeb6e1f HEAD@{0}: reset: moving to HEAD~3
# b211adf HEAD@{1}: commit: c4
git reset --hard HEAD@{1}      # или ORIG_HEAD
git branch rescue b211adf      # либо сохранить в новую ветку
```

`ORIG_HEAD` автоматически указывает на положение HEAD до последнего reset, merge или rebase. Что reflog **не** спасёт: правки, которые не были ни закоммичены, ни добавлены в индекс. Если же файл успели сделать `git add`, его blob лежит в базе — `git fsck --lost-found` положит его в `.git/lost-found/other/`.

## Поиск: bisect, blame, log -S

`git bisect` двоичным поиском находит коммит, внёсший регрессию: за ~log₂(N) шагов.

```bash
git bisect start HEAD v1.2.0   # плохой, хороший
git bisect run ./test.sh       # 0 = good, 125 = skip, 1..127 = bad
git bisect reset
```

- `git blame -L 40,60 app.py` — кто и в каком коммите последним менял строки.
- `git log -S "API_KEY"` — коммиты, где изменилось число вхождений строки (pickaxe); `-G` ищет по регулярке в диффах.
- `git log --grep="JIRA-123"` — поиск по сообщениям коммитов.

## Секреты и .gitignore

`.gitignore` действует только на неотслеживаемые файлы. Чтобы перестать отслеживать уже закоммиченный файл:

```bash
echo ".env" >> .gitignore
git rm --cached .env           # файл останется на диске
git commit -m "stop tracking .env"
```

Но в старых коммитах секрет остаётся. Порядок действий при утечке:

1. Немедленно отозвать и ротировать секрет — он уже скомпрометирован.
2. Переписать историю: `git filter-repo --path .env --invert-paths` (рекомендуемая замена `filter-branch`; альтернатива — BFG).
3. Force-push всех веток и тегов, попросить коллег переклонировать репозиторий.
4. Учесть копии в форках, кэшах и refs pull request-ов на хостинге.

## Частые вопросы на собеседовании

- Чем reset отличается от revert? → reset двигает ветку (переписывает историю), revert добавляет обратный коммит (безопасно для общих веток).
- Сделал `reset --hard`, как вернуть? → `git reflog`, затем `git reset --hard HEAD@{1}` или `ORIG_HEAD`.
- Почему файл из `.gitignore` всё равно в `git status`? → Он уже отслеживается; нужен `git rm --cached`.
- Запушили пароль — что делать? → Сначала ротировать, потом чистить историю filter-repo.
- Как найти коммит с регрессией? → `git bisect`, лучше с `bisect run` и автотестом.

## Шпаргалка

```bash
git reset --soft|--mixed|--hard <commit>
git revert <sha> / git revert -m 1 <merge>
git commit --amend --no-edit
git restore [--staged] [--source=<commit>] <file>
git stash -u / pop / apply / drop / list
git clean -n / -fd
git reflog / git reset --hard HEAD@{1}
git fsck --lost-found
git bisect start|good|bad|run|reset
git log -S "строка" / git blame -L a,b file
git rm --cached <file>
git filter-repo --path <file> --invert-paths
```
