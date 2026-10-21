-- 匿名の書き込みの流量制限（Q-007）。接続元 IP・種類（post / vote）・固定窓の始まりごとの回数。
-- 過ぎた窓の行は、同じ IP と種類の次の書き込みで消す（src/guard.ts）。
CREATE TABLE rate_limits (
    ip TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('post', 'vote')),
    window_start TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (ip, action, window_start)
);
