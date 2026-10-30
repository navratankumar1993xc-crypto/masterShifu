-- ════════════════════════════════════════════════════════════════════════════
-- Old IDs ka username = email se @ aur domain hata ke (PostgreSQL)
--   natrajdev@webts.online  ->  natrajdev
--   sud@seller              ->  sud
-- Jinka @ se pehle wala part same hai, unme domain ka naam jud jata hai:
--   rani@dev -> ranidev,  rani@master -> ranimaster,  rani@admin -> raniadmin,  rani@super -> ranisuper
--
-- Sirf auto-generated / khali usernames badalte hain; panel se haath se
-- rakhe gaye usernames waise hi rahenge. Dobara chalana safe hai.
-- Run:  psql -U <user> -d <db> -f database/fix_usernames.sql
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) DEFAULT NULL;
DROP INDEX IF EXISTS uq_users_username;        -- purana (email ke @ se pehle wale part pe)
DROP INDEX IF EXISTS uq_users_username_col;    -- neeche dobara banega

-- 1) @ aur domain hatao
UPDATE users
SET username = lower(split_part(email, '@', 1))
WHERE username IS NULL
   OR username = lower(split_part(email, '@', 1))
   OR username = lower(split_part(email, '@', 1)) || id
   OR username = lower(split_part(email, '@', 1) || split_part(split_part(email, '@', 2), '.', 1));

-- 2) Same username wale IDs (rani@dev, rani@master ...) me domain ka naam jodo
UPDATE users
SET username = lower(split_part(email, '@', 1) || split_part(split_part(email, '@', 2), '.', 1))
WHERE username = lower(split_part(email, '@', 1))
  AND username IN (SELECT username FROM users GROUP BY username HAVING COUNT(*) > 1);

-- Ab bhi duplicate ho to yeh fail karega (aur kuch save nahi hoga) — upar wali list check karo
CREATE UNIQUE INDEX uq_users_username_col ON users (username);

COMMIT;

-- Check:
SELECT id, username, email, role FROM users ORDER BY username;
