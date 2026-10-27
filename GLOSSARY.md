# Grafito

Herramienta personal: el usuario habla y Claude dibuja la idea en vivo sobre un tablero estilo boceto.

## Iconos

**Catálogo de iconos**:
Un conjunto de iconos de un proveedor (hoy solo AWS) que el usuario habilita o deshabilita desde la configuración.
_Avoid_: librería de iconos, pack

**Icono de servicio**:
El icono oficial de un servicio concreto (ej. Lambda, Cognito, S3) que acompaña a un elemento del dibujo cuando ese elemento es ese servicio.
_Avoid_: emoji, logo

**Lista curada**:
Los servicios de un catálogo de iconos que Grafito reconoce (hoy 40 de AWS). Un servicio fuera de la lista se dibuja sin icono de servicio.
_Avoid_: catálogo completo

**Id de servicio**:
El nombre corto y fijo con que Claude marca un elemento como un servicio de la lista curada (ej. `s3`, `api-gateway`).
_Avoid_: nombre oficial, etiqueta
