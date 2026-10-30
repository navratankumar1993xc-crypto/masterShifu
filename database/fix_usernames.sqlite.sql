-- ════════════════════════════════════════════════════════════════════════════
-- Old IDs ka username = email se @ aur domain hata ke (SQLite)
--   natrajdev@webts.online  ->  natrajdev
--   sud@seller              ->  sud
-- Jinka @ se pehle wala part same hai, unme domain ka naam jud jata hai:
--   rani@dev -> ranidev,  rani@master -> ranimaster,  rani@admin -> raniadmin,  rani@super -> ranisuper
--
-- Sirf auto-generated / khali usernames badalte hain; panel se haath se
-- rakhe gaye usernames waise hi rahenge. Dobara chalana safe hai.
-- Pehle server ek baar start kar lo (username column ban jayega), phir:
--   sqlite3 data/web_ts_panel.sqlite < database/fix_usernames.sqlite.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DROP INDEX IF EXISTS uq_users_username;
DROP INDEX IF EXISTS uq_users_username_col;

-- local = @ se pehle,  dom = domain ka pehla hissa (webts.online -> webts, dev -> dev)
CREATE TEMP TABLE _u AS
SELECT id,
       lower(substr(email, 1, instr(email, '@') - 1)) AS local,
       lower(CASE WHEN instr(substr(email, instr(email, '@') + 1), '.') > 0
                  THEN substr(substr(email, instr(email, '@') + 1), 1, instr(substr(email, instr(email, '@') + 1), '.') - 1)
                  ELSE substr(email, instr(email, '@') + 1) END) AS dom
FROM users WHERE instr(email, '@') > 0;

-- 1) @ aur domain hatao
UPDATE users
SET username = (SELECT local FROM _u WHERE _u.id = users.id)
WHERE id IN (SELECT id FROM _u)
  AND (username IS NULL
       OR username = (SELECT local FROM _u WHERE _u.id = users.id)
       OR username = (SELECT local || users.id FROM _u WHERE _u.id = users.id)
       OR username = (SELECT local || dom FROM _u WHERE _u.id = users.id));

-- 2) Same username wale IDs (rani@dev, rani@master ...) me domain ka naam jodo
UPDATE users
SET username = (SELECT local || dom FROM _u WHERE _u.id = users.id)
WHERE username = (SELECT local FROM _u WHERE _u.id = users.id)
  AND username IN (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1);

DROP TABLE _u;

-- Ab bhi duplicate ho to yeh fail karega — upar wali list check karo
CREATE UNIQUE INDEX uq_users_username_col ON users (username);

COMMIT;

-- Check:
SELECT id, username, email, role FROM users ORDER BY username;
