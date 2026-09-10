targetScope = 'subscription'

// ---------------------------------------------------------------------------
// ERP Support Copilot - root deployment.
//
// Describes the resources that were first built by hand in the portal, so the
// whole stack can be recreated in a fresh environment with `azd up`.
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(24)
@description('Name of the azd environment. Names the resource group and tags every resource.')
param environmentName string

@minLength(1)
@description('Primary region. Sweden Central keeps data in the EU and supports every service used here.')
param location string

@description('Image to run. Empty on first provision, then azd supplies the built image.')
param webImageName string = ''

var tags = {
  'azd-env-name': environmentName
  project: 'erp-copilot'
  owner: 'nsk'
}

// Short deterministic suffix for globally-unique names. Deterministic matters:
// re-running targets the same resources instead of creating new ones.
var resourceToken = uniqueString(subscription().id, environmentName, location)

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: { location: location, tags: tags, resourceToken: resourceToken }
}

module foundry './modules/foundry.bicep' = {
  name: 'foundry'
  scope: rg
  params: { location: location, tags: tags, resourceToken: resourceToken }
}

module search './modules/search.bicep' = {
  name: 'search'
  scope: rg
  params: { location: location, tags: tags, resourceToken: resourceToken }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: { location: location, tags: tags, resourceToken: resourceToken }
}

module cosmos './modules/cosmos.bicep' = {
  name: 'cosmos'
  scope: rg
  params: { location: location, tags: tags, resourceToken: resourceToken }
}

module containerApp './modules/containerapp.bicep' = {
  name: 'containerapp'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    imageName: webImageName
    // Endpoints only. Keys are supplied as Container Apps secrets when the app
    // is actually deployed, which is not yet.
    extraEnv: [
      { name: 'AZURE_FOUNDRY_ENDPOINT', value: foundry.outputs.endpoint }
      { name: 'AZURE_SEARCH_ENDPOINT', value: search.outputs.endpoint }
      { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.outputs.endpoint }
      { name: 'AZURE_STORAGE_ACCOUNT', value: storage.outputs.name }
    ]
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_FOUNDRY_ENDPOINT string = foundry.outputs.endpoint
output AZURE_SEARCH_ENDPOINT string = search.outputs.endpoint
output AZURE_COSMOS_ENDPOINT string = cosmos.outputs.endpoint
output AZURE_STORAGE_ACCOUNT string = storage.outputs.name
output SERVICE_WEB_URI string = containerApp.outputs.uri
output APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.appInsightsConnectionString
