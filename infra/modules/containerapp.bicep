// Container Apps environment + the Next.js web app.
//
// minReplicas: 0 means the app costs nothing while idle (the consumption plan's
// monthly free grant covers the rest of a demo's traffic). The trade-off is a
// ~5-10s cold start on the first request after a quiet period.

param location string
param tags object
param resourceToken string

param logAnalyticsWorkspaceId string
param appInsightsConnectionString string
param registryLoginServer string
param identityResourceId string
param identityClientId string

@description('Image to run. Empty on the first provision, when a public placeholder is used until azd pushes the real image.')
param imageName string = ''

@description('Extra environment variables, appended by later phases (Foundry, Search, Cosmos endpoints).')
param extraEnv array = []

param cpu string = '0.5'
param memory string = '1Gi'
param minReplicas int = 0
param maxReplicas int = 3
param targetPort int = 3000

var placeholderImage = 'mcr.microsoft.com/k8se/quickstart:latest'
var usePlaceholder = empty(imageName)

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: last(split(logAnalyticsWorkspaceId, '/'))
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

resource web 'Microsoft.App/containerApps@2025-01-01' = {
  // The azd-service-name tag is how `azd deploy` finds this app.
  name: 'ca-web-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        // The placeholder image listens on 80; the real one on 3000.
        targetPort: usePlaceholder ? 80 : targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: usePlaceholder ? [] : [
        {
          server: registryLoginServer
          identity: identityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: usePlaceholder ? placeholderImage : imageName
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: union([
            {
              // Tells DefaultAzureCredential which user-assigned identity to use.
              name: 'AZURE_CLIENT_ID'
              value: identityClientId
            }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              value: appInsightsConnectionString
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
          ], extraEnv)
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

output name string = web.name
output uri string = 'https://${web.properties.configuration.ingress.fqdn}'
output environmentName string = containerAppsEnvironment.name
