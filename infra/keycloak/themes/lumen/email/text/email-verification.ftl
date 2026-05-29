<#if user?? && (user.firstName)?has_content>Hallo ${user.firstName},<#else>Hallo,</#if>

bitte bestaetige deine E-Mail-Adresse fuer dein Lumen-Konto:

${link}

Der Link ist ${linkExpirationFormatter(linkExpiration)} gueltig.

-- Lumen . light, selbstgehosteter Foto-Entwickler
