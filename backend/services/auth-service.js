// Fly2Git Backend — Authentication Service (Phase 12C)
// Native cryptographic authentication using PBKDF2 and HMAC-SHA256 tokens.
// No external dependencies.

const crypto = require("crypto");
const config = require("../config");

class AuthService {
  constructor(database) {
    this.db = database;
    this.secret = config.authSecret;
    this.tokenExpiryMs = config.authExpiresInMs;
  }

  /**
   * Hashes a password using PBKDF2 with salt.
   */
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return `${salt}:${hash}`;
  }

  /**
   * Verifies password against stored salt:hash.
   */
  verifyPassword(password, stored) {
    if (!stored || !stored.includes(":")) return false;
    const [salt, originalHash] = stored.split(":");
    const testHash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(testHash, "hex"), Buffer.from(originalHash, "hex"));
  }

  /**
   * Generates a signed tamper-proof Bearer token (JWT-style HMAC-SHA256).
   */
  generateToken(user) {
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const now = Date.now();
    const payload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        email: user.email,
        iat: now,
        exp: now + this.tokenExpiryMs,
      })
    ).toString("base64url");

    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    return `${header}.${payload}.${signature}`;
  }

  /**
   * Verifies a Bearer token and returns payload if valid.
   */
  verifyToken(token) {
    if (!token || typeof token !== "string") return null;
    const parts = token.trim().split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", this.secret)
      .update(`${header}.${payload}`)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (data.exp && Date.now() > data.exp) {
        return null; // Expired
      }
      return data;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Registers a new user with email and password.
   */
  async register(email, password) {
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      throw new Error("Email and password are required");
    }
    const cleanEmail = email.trim().toLowerCase();
    const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!EMAIL_REGEX.test(cleanEmail) || cleanEmail.length > 254) {
      throw new Error("Invalid email address format");
    }
    if (password.length < 8 || password.length > 128) {
      throw new Error("Password must be between 8 and 128 characters");
    }

    const existing = this.db.getUserByEmail(cleanEmail);
    if (existing) {
      throw new Error("User with this email already exists");
    }

    const user = this.db.insertUser({
      id: `usr_${crypto.randomBytes(12).toString("hex")}`,
      email: cleanEmail,
      passwordHash: this.hashPassword(password),
    });

    // Default entitlement: Basic
    this.db.setEntitlement({
      userId: user.id,
      plan: "basic",
      status: "active",
      billingCycle: null,
      expiresAt: null,
    });

    const token = this.generateToken(user);
    return { user: { id: user.id, email: user.email }, token };
  }

  /**
   * Authenticates user with email and password using constant-time check.
   */
  async login(email, password) {
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      throw new Error("Email and password are required");
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = this.db.getUserByEmail(cleanEmail);

    // Dummy comparison to prevent timing-based user enumeration
    const dummyHash =
      "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    const passwordHash = user && user.passwordHash ? user.passwordHash : dummyHash;
    const match = this.verifyPassword(password, passwordHash);

    if (!user || !match) {
      throw new Error("Invalid email or password");
    }

    const token = this.generateToken(user);
    return { user: { id: user.id, email: user.email }, token };
  }
}

module.exports = AuthService;
