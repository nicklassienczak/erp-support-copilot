// Azure Container Registry, Basic tier (~$5/month — the only real fixed cost
// in this project). adminUserEnabled stays false so images are pulled with the
// app's managed identity instead of a stored password.

param location string
param tags object
param resourceToken string

@allowed(['Basic', 'Standard', 'Premium'])
param sku string = 'Basic'

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  // uniqueString() always returns 13 chars, so this is always 16 — the linter
  // just can't prove it.
  #disable-next-line BCP334
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties: {
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

output name string = registry.name
output loginServer string = registry.properties.loginServer
output resourceId string = registry.id
