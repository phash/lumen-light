<#if user?? && (user.firstName)?has_content>Hallo ${user.firstName},<#else>Hallo,</#if>

fuer dein Lumen-Konto wurde das Zuruecksetzen des Passworts angefordert. Lege hier ein neues Passwort fest:

${link}

Der Link ist ${linkExpirationFormatter(linkExpiration)} gueltig. Wenn du das nicht angefordert hast, ignoriere diese E-Mail.

-- Lumen . light, selbstgehosteter Foto-Entwickler
