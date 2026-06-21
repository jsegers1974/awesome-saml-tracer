#!/usr/bin/env bash
# Regenerate the MetaCompare offline test kit.
# Produces a saml-tracer-format capture (base64 SAMLResponse) plus matching and
# deliberately-broken IdP/SP metadata, using real self-signed certs so the
# signing-cert check is authentic. Run from this directory: ./generate.sh
set -euo pipefail
cd "$(dirname "$0")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Two distinct self-signed certs: cert1 is the "live" signing cert (in the
# assertion + matching IdP metadata); cert2 simulates a rotated/replaced cert.
gencert() { # $1 = CN, $2 = out var name
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$1" \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
  openssl x509 -in "$TMP/cert.pem" -outform DER 2>/dev/null | base64 | tr -d '\n'
}
CERT1="$(gencert idp.local)"
CERT2="$(gencert idp.local-rotated)"

IDP="https://idp.local/metadata"
SP="https://sp.local/metadata"
ACS="https://sp.local/acs"

# --- the SAMLResponse (gets base64'd into the capture) ---
cat > "$TMP/response.xml" <<XML
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ID="_resp_kit_1" Version="2.0" IssueInstant="2026-06-16T12:00:00Z" Destination="$ACS">
  <saml:Issuer>$IDP</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion ID="_assert_kit_1" Version="2.0" IssueInstant="2026-06-16T12:00:00Z">
    <saml:Issuer>$IDP</saml:Issuer>
    <ds:Signature><ds:SignedInfo/><ds:SignatureValue>NOT-A-REAL-SIGNATURE</ds:SignatureValue>
      <ds:KeyInfo><ds:X509Data><ds:X509Certificate>$CERT1</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">jane.doe@example.com</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData Recipient="$ACS" NotOnOrAfter="2026-06-16T13:00:00Z"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="2026-06-16T11:55:00Z" NotOnOrAfter="2026-06-16T13:00:00Z">
      <saml:AudienceRestriction><saml:Audience>$SP</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AttributeStatement>
      <saml:Attribute Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="email"><saml:AttributeValue>jane.doe@example.com</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="urn:oid:2.5.4.42" FriendlyName="givenName"><saml:AttributeValue>Jane</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>
XML
B64="$(base64 < "$TMP/response.xml" | tr -d '\n')"

# --- capture.json (saml-tracer format the popup's import understands) ---
cat > capture.json <<JSON
{
  "requests": [
    {
      "requestId": "metacompare-kit-1",
      "timestamp": 1781000000000,
      "method": "POST",
      "url": "$ACS",
      "type": "main_frame",
      "protocol": "SAML-P",
      "responseStatus": 200,
      "responseStatusText": "200 OK",
      "post": [["SAMLResponse", "$B64"], ["RelayState", "/dashboard"]]
    }
  ]
}
JSON

# --- matching metadata (all checks green) ---
cat > idp-metadata.xml <<XML
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="$IDP">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>$CERT1</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.local/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
XML

cat > sp-metadata.xml <<XML
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="$SP">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService index="0" isDefault="true" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="$ACS"/>
    <md:AttributeConsumingService index="0">
      <md:ServiceName xml:lang="en">Test SP</md:ServiceName>
      <md:RequestedAttribute Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="email" isRequired="true"/>
    </md:AttributeConsumingService>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
XML

# --- broken IdP: rotated signing cert -> signing-cert mismatch ---
cat > idp-metadata-BROKEN-rotated-cert.xml <<XML
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="$IDP">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>$CERT2</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.local/sso"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
XML

# --- broken SP: wrong ACS URL + a required attribute the assertion lacks ---
cat > sp-metadata-BROKEN-acs-and-required-attr.xml <<XML
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="$SP">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService index="0" isDefault="true" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://sp.local/acs-OLD-ENDPOINT"/>
    <md:AttributeConsumingService index="0">
      <md:ServiceName xml:lang="en">Test SP</md:ServiceName>
      <md:RequestedAttribute Name="urn:oid:0.9.2342.19200300.100.1.3" FriendlyName="email" isRequired="true"/>
      <md:RequestedAttribute Name="urn:oid:1.3.6.1.4.1.5923.1.1.1.1" FriendlyName="eduPersonAffiliation" isRequired="true"/>
    </md:AttributeConsumingService>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
XML

echo "Generated: capture.json, idp-metadata.xml, sp-metadata.xml, idp-metadata-BROKEN-rotated-cert.xml, sp-metadata-BROKEN-acs-and-required-attr.xml"
