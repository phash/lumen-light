<#if user?? && (user.firstName)?has_content>Hallo ${user.firstName},<#else>Hallo,</#if>

willkommen bei Lumen. Schliesse die Einrichtung deines Kontos ab (E-Mail bestaetigen und Passwort festlegen):

${link}

Der Link ist ${linkExpirationFormatter(linkExpiration)} gueltig. War das nicht du, ignoriere diese E-Mail.

-- Lumen . light, selbstgehosteter Foto-Entwickler
