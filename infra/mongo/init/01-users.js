// Runs once, on first start with an empty data volume (image entrypoint, /docker-entrypoint-initdb.d).
// The root user is created by the entrypoint itself from MONGODB_INITDB_ROOT_*.
const DATABASES = ["asset_journey", "pharmaedge", "Cluster0"];
const admin = db.getSiblingDB("admin");
const readWrite = DATABASES.map((name) => ({ role: "readWrite", db: name }));

// Our services (api, crawler): container-internal and local development.
admin.createUser({ user: "app", pwd: process.env.MONGO_APP_PASSWORD, roles: readWrite });
// Teammates' crawlers connecting from outside (over TLS).
admin.createUser({ user: "team", pwd: process.env.MONGO_TEAM_PASSWORD, roles: readWrite });
// mongot's sync user.
admin.createUser({ user: "mongot", pwd: process.env.MONGOT_PASSWORD, roles: ["searchCoordinator"] });
