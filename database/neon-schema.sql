CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin')),
    email VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donors (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    fullname VARCHAR(100) NOT NULL,
    age INTEGER NOT NULL CHECK (age BETWEEN 18 AND 65),
    gender VARCHAR(10) NOT NULL CHECK (gender IN ('Male', 'Female', 'Other')),
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    address TEXT NOT NULL,
    last_donation_date DATE,
    availability BOOLEAN NOT NULL DEFAULT TRUE,
    profile_picture TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donor_accounts (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    donor_id TEXT NOT NULL UNIQUE REFERENCES donors(id) ON DELETE CASCADE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS blood_requests (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    patient_name VARCHAR(100) NOT NULL,
    blood_group VARCHAR(3) NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-')),
    units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 20),
    hospital VARCHAR(150) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    needed_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Fulfilled')),
    is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS donations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    donation_date DATE NOT NULL,
    location VARCHAR(150) NOT NULL,
    units INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_donors_blood_group ON donors(blood_group);
CREATE INDEX IF NOT EXISTS idx_donors_availability ON donors(availability);
CREATE INDEX IF NOT EXISTS idx_requests_blood_group ON blood_requests(blood_group);
CREATE INDEX IF NOT EXISTS idx_requests_status ON blood_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_emergency ON blood_requests(is_emergency);
CREATE INDEX IF NOT EXISTS idx_donations_donor_id ON donations(donor_id);
CREATE INDEX IF NOT EXISTS idx_donations_date ON donations(donation_date);