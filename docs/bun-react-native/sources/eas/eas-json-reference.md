---
source: https://docs.expo.dev/eas/json/ (GitHub: https://github.com/expo/expo/blob/fe4a2c8e7875d56283ab314a9b4a0da6b6df159d/docs/pages/eas/json.mdx)
fetched: 2026-10-12
repo_sha: fe4a2c8e7875d56283ab314a9b4a0da6b6df159d
---

---
title: Configuration with eas.json
description: Learn about available properties for EAS Build and EAS Submit to configure and override their default behavior from within your project.
maxHeadingDepth: 4
---

**eas.json** is the configuration file for EAS CLI and services. You can find the complete reference of all available schema properties for [EAS Build](/build/introduction) and [EAS Submit](/deploy/submit-to-app-stores/) on this page.

> **info** To learn more about how a project using EAS services is configured with **eas.json**, see [Configure EAS Build with eas.json](/build/eas-json/) and [Configure EAS Submit with eas.json](/submit/eas-json/).

## EAS Build

The following properties are available in the schema for the `build` key in **eas.json**.

<Collapsible summary="Example schema of multiple build profiles">

```json eas.json
{
  "build": {
    "base": {
      "node": "12.13.0",
      "yarn": "1.22.5",
      "env": {
        "EXAMPLE_ENV": "example value"
      },
      "android": {
        "image": "default",
        "env": {
          "PLATFORM": "android"
        }
      },
      "ios": {
        "image": "latest",
        "env": {
          "PLATFORM": "ios"
        }
      }
    },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "env": {
        "ENVIRONMENT": "development"
      },
      "android": {
        "distribution": "internal",
        "withoutCredentials": true
      },
      "ios": {
        "simulator": true
      }
    },
    "staging": {
      "extends": "base",
      "env": {
        "ENVIRONMENT": "staging"
      },
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "extends": "base",
      "env": {
        "ENVIRONMENT": "production"
      }
    }
  }
}
```

</Collapsible>

### Common properties for native platforms

<EasJsonPropertiesTable schema={commonSchema} />

### Android-specific options

<EasJsonPropertiesTable schema={androidSchema} />

### iOS-specific options

<EasJsonPropertiesTable schema={iosSchema} />

## EAS Submit

The following properties are available in the schema for the `submit` key in **eas.json**.

<Collapsible summary="Example schema of with production profile">

```json eas.json
{
  "cli": {
    "version": ">= 0.34.0"
  },
  "submit": {
    "production": {
      "android": {
        "track": "internal"
      },
      "ios": {
        "appleId": "john@turtle.com",
        "ascAppId": "1234567890",
        "appleTeamId": "AB12XYZ34S"
      }
    }
  }
}
```

</Collapsible>

### Android-specific options

<EasJsonPropertiesTable schema={submitAndroidSchema} />

### iOS-specific options

<EasJsonPropertiesTable schema={submitIosSchema} />
