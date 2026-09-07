// Every role assignment in one reviewable place.
//
// Two principals matter:
//   - appPrincipalId       the container app's managed identity (runtime)
//   - developerPrincipalId you, so the same code runs locally under `az login`
//
// Later phases add Foundry, Search, Storage and Cosmos assignments here. Note
// that Cosmos data-plane access is NOT an RBAC role assignment — it needs a
// sqlRoleAssignment on the account, handled in cosmos.bicep.

param registryName string
param appPrincipalId string

@description('Developer or CI principal. Empty means skip the developer assignments (e.g. unattended CI).')
// Unused until Phase 2 grants this principal Foundry access for local runs.
#disable-next-line no-unused-params
param developerPrincipalId string = ''

// Built-in role definition ids. Hard-coded GUIDs because the names are not
// resolvable from Bicep, and these are stable across clouds.
var roles = {
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' existing = {
  name: registryName
}

// Lets the container app pull its image with a managed identity instead of a
// registry password.
resource acrPullApp 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appPrincipalId, roles.acrPull)
  scope: registry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.acrPull)
    principalId: appPrincipalId
    principalType: 'ServicePrincipal'
  }
}
