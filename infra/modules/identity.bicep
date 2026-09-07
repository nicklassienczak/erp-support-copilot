// User-assigned managed identity for the web app.
//
// User-assigned rather than system-assigned on purpose: the identity exists
// before the container app, so every role assignment can be created in the
// same deployment without a second pass, and the identity survives if the app
// is deleted and recreated.

param location string
param tags object
param resourceToken string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: 'id-web-${resourceToken}'
  location: location
  tags: tags
}

output resourceId string = identity.id
output name string = identity.name
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
