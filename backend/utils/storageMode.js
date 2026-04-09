const { DB_PATH } = require("../db/database");
const { getUserStoreState } = require("../services/userStore");
const { HttpError } = require("./httpError");

const IS_VERCEL = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const IS_EPHEMERAL_SQLITE = IS_VERCEL && DB_PATH.startsWith("/tmp");

const USER_MUTATION_LOCK_MESSAGE =
  "Administracion de usuarios bloqueada por seguridad: este despliegue usa SQLite temporal en Vercel y puede perder cambios al reiniciar. Para habilitar cambios persistentes migra usuarios/auth a PostgreSQL o a una base externa.";

function getStorageState() {
  const userStoreState = getUserStoreState();
  const lockUserMutations =
    !userStoreState.persistent &&
    IS_EPHEMERAL_SQLITE &&
    process.env.ALLOW_UNSAFE_USER_MUTATIONS !== "true";

  return {
    provider: userStoreState.provider,
    persistent: userStoreState.persistent,
    mirror: userStoreState.mirror,
    vercel: IS_VERCEL,
    ephemeral: IS_EPHEMERAL_SQLITE,
    lockUserMutations,
    message: lockUserMutations ? USER_MUTATION_LOCK_MESSAGE : "Persistencia operativa habilitada.",
  };
}

function assertUserMutationsAllowed() {
  const storageState = getStorageState();
  if (!storageState.lockUserMutations) {
    return;
  }

  throw new HttpError(503, USER_MUTATION_LOCK_MESSAGE, {
    storage: storageState,
  });
}

module.exports = {
  getStorageState,
  assertUserMutationsAllowed,
  USER_MUTATION_LOCK_MESSAGE,
};
