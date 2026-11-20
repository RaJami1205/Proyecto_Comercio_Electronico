-- CN-57: usuario de ejecución del Backend.
-- La contraseña se configurará por separado.

CREATE ROLE cibernova_app
WITH LOGIN INHERIT
NOSUPERUSER
NOCREATEDB
NOCREATEROLE
NOREPLICATION
NOBYPASSRLS;

GRANT commerce_runtime TO cibernova_app;