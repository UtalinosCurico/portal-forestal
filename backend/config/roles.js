const ROLES = Object.freeze({
  ADMINISTRADOR: "Administrador",
  SUPERVISOR: "Supervisor",
  JEFE_FAENA: "Jefe de faena",
  OPERADOR: "Operador",
});

const ROLE_LIST = Object.values(ROLES);

module.exports = {
  ROLES,
  ROLE_LIST,
};

