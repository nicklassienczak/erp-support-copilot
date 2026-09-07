targetScope = 'subscription'

// ---------------------------------------------------------------------------
// ERP Support Copilot — root deployment.
// Creates the resource group and wires every module together.
// Grows one module per build phase; Phase 1 = platform skeleton only.
// ---------------------------------------------------------------------------

@minLength(1)
@maxLength(24)
@description('Name of the azd environment. Names the resource group and tags every resource.')
param environmentName string

@minLength(1)
@description('Primary region. Sweden Central is the default: free-tier AI Search there includes semantic ranker and agentic retrieval, and it keeps data in the EU.')
param location string

@description('Object id of the developer or CI principal running the deployment. azd populates this; it is granted data-plane roles so local runs work under `az login`.')
param principalId string = ''

@description('Container image for the web service. Empty on first provision, then azd supplies the built image.')
param webImageName string = ''

var tags = {
  'azd-env-name': environmentName
  project: 'erp-support-copilot'
}

// Short deterministic suffix for globally-unique resource names.
var resourceToken = uniqueString(subscription().id, environmentName, location)

resource rg 'Microsoft.Resources/resourceGroups@2024-11-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module registry './modules/registry.bicep' = {
  name: 'registry'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module identity './modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
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
    registryLoginServer: registry.outputs.loginServer
    identityResourceId: identity.outputs.resourceId
    identityClientId: identity.outputs.clientId
    imageName: webImageName
  }
}

module rbac './modules/rbac.bicep' = {
  name: 'rbac'
  scope: rg
  params: {
    registryName: registry.outputs.name
    appPrincipalId: identity.outputs.principalId
    developerPrincipalId: principalId
  }
}

// --- azd-consumed outputs -------------------------------------------------
output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.name

// --- app configuration outputs --------------------------------------------
output SERVICE_WEB_NAME string = containerApp.outputs.name
output SERVICE_WEB_URI string = containerApp.outputs.uri
output APPLICATIONINSIGHTS_CONNECTION_STRING string = monitoring.outputs.appInsightsConnectionString
