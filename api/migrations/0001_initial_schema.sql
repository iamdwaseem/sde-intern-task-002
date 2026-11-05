CREATE TABLE homes (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,

    CONSTRAINT ck_homes_name_nonempty
        CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    home_id TEXT NOT NULL,
    name TEXT NOT NULL,

    CONSTRAINT uq_members_id
        UNIQUE (id),

    CONSTRAINT uq_members_home_id
        UNIQUE (home_id, id),

    CONSTRAINT fk_members_home
        FOREIGN KEY (home_id)
        REFERENCES homes(id)
        ON DELETE RESTRICT,

    CONSTRAINT ck_members_name_nonempty
        CHECK (length(trim(name)) > 0)
);

CREATE TABLE bills (
    id TEXT NOT NULL PRIMARY KEY,
    home_id TEXT NOT NULL,
    title TEXT NOT NULL,
    total_cents INTEGER NOT NULL,

    CONSTRAINT uq_bills_home_id
        UNIQUE (home_id, id),

    CONSTRAINT fk_bills_home
        FOREIGN KEY (home_id)
        REFERENCES homes(id)
        ON DELETE RESTRICT,

    CONSTRAINT ck_bills_title_nonempty
        CHECK (length(trim(title)) > 0),

    CONSTRAINT ck_bills_total_positive_integer
        CHECK (
            typeof(total_cents) = 'integer'
            AND total_cents > 0
        )
);

CREATE TABLE shares (
    id TEXT NOT NULL PRIMARY KEY,
    home_id TEXT NOT NULL,
    bill_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    paid_at TEXT,
    idempotency_key TEXT,

    CONSTRAINT fk_shares_bill_home
        FOREIGN KEY (home_id, bill_id)
        REFERENCES bills(home_id, id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_shares_member_home
        FOREIGN KEY (home_id, member_id)
        REFERENCES members(home_id, id)
        ON DELETE RESTRICT,

    CONSTRAINT ck_shares_amount_nonnegative_integer
        CHECK (
            typeof(amount_cents) = 'integer'
            AND amount_cents >= 0
        ),

    CONSTRAINT ck_shares_payment_state
        CHECK (
            (paid_at IS NULL AND idempotency_key IS NULL)
            OR
            (
                paid_at IS NOT NULL
                AND length(trim(paid_at)) > 0
                AND idempotency_key IS NOT NULL
                AND length(trim(idempotency_key)) > 0
            )
        ),

    CONSTRAINT uq_shares_bill_member
        UNIQUE (bill_id, member_id)
);

CREATE INDEX idx_bills_home_id
    ON bills(home_id);

CREATE INDEX idx_members_home_position
    ON members(home_id, position);

CREATE INDEX idx_shares_home_bill
    ON shares(home_id, bill_id);

CREATE INDEX idx_shares_home_member_paid
    ON shares(home_id, member_id, paid_at);