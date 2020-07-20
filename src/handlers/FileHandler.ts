import * as vscode from 'vscode'

import { Mutex } from 'async-mutex'

import {
  ResourceFile,
  AnimationControllerFile,
  AnimationFile,
  ClientEntityDefinitionFile,
  GeometryFile,
  MaterialFile,
  ParticleFile,
  RenderControllerFile,
  ServerEntityDefinitionFile,
  SoundEffectFile,
  ServerBlockFile
} from '../files'

type HandlerType = typeof ResourceFile & (new (uri: vscode.Uri) => ResourceFile)

/**
 * The various types of files
 */
export enum FileType {
  None,
  AnimationController,
  Animation,
  RenderController,
  Geometry,
  Material,
  Particle,
  Texture,
  ClientEntityIdentifier,
  ServerEntityIdentifier,
  EventIdentifier,
  ComponentGroup,
  Animate,
  SoundEffect,
  Block,

  McFunction,
}

export enum BehaviourDefinitionType {
  Events,
  ComponentGroups,
}

export type LocationData = { uri: vscode.Uri, range: vscode.Range, resourceFile: ResourceFile }
export type DefinitionLocation = Map<string, LocationData>

export enum DataType {
  Definition,
  ServerEntityEvents,
  ServerEntityComponentGroups,
}

// each type to the files it has
export type FilesData = Map<FileType, FileData>
// the string path to the types of data in the file
export type FileData = Map<string, ResourceFile>
// the types of data to the data amp
export type DataTypeMap = Map<DataType, Data>
// the data ids to the data
export type Data<T = RangeInfo> = Map<string, T>
export type RangeInfo = { range: vscode.Range }

class FileHandler {
  private filesCache: FilesData = new Map()
  private bulkMutex: { [key in FileType]?: Mutex } = {}

  private handlers: Map<FileType, HandlerType> = new Map([
    [ FileType.Geometry, GeometryFile ],
    [ FileType.Particle, ParticleFile ],
    [ FileType.Material, MaterialFile ],
    [ FileType.Animation, AnimationFile ],
    [ FileType.AnimationController, AnimationControllerFile ],
    [ FileType.RenderController, RenderControllerFile ],
    [ FileType.ServerEntityIdentifier, ServerEntityDefinitionFile ],
    [ FileType.ClientEntityIdentifier, ClientEntityDefinitionFile ],
    [ FileType.SoundEffect, SoundEffectFile ],
    [ FileType.Block, ServerBlockFile ],
  ])

  /**
   * Empty the file cache
   */
  public emptyCache () {
    this.filesCache.clear()
  }

  /**
   * Returns a handler based on the file type provided
   * @param type the type of handler to get
   */
  public getFileHandler (type: FileType) {
    return this.handlers.get(type)
  }

  public getFile (file: vscode.Uri) {
    const path = file.path
    let resp = { type: FileType.None, file: undefined }
    for (let [ type, files ] of this.filesCache) {
      if (files.has(path)) {
        return { type, file: files.get(path)! }
      }
    }
    return resp
  }

  /**
   * Refresh the cache for a file
   * @param file the file to refresh
   */
  public async refreshCacheForFile (file: vscode.Uri) {
    const { type, file: resourceFile } = this.getFile(file)
    if (type !== FileType.None) {
      await resourceFile?.extract()
    }
  }

  /**
   * Delete a file by uri from the cache
   * @param file the file to delete from the cache
   */
  public deleteFileFromCache (file: vscode.Uri) {
    const path = file.path
    const { type } = this.getFile(file)
    if (type) this.filesCache.get(type)?.delete(path)
  }

  /**
   * Only parse the file if file not in cache
   * @param type the type of data to get
   */
  private async conditionallyGetByType (type: FileType) {
    if (!this.filesCache.has(type)) this.filesCache.set(type, new Map())

    const typeMap = this.filesCache.get(type)!
    const Handler = this.getFileHandler(type)
    if (Handler) {
      const gen = Handler.getGlobGenerator()

      // show progress while getting all the files
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: `Updating Bedrock Definitions for "${Handler.title}"...`
      }, async () => {
        for await (let file of gen) {
          if (!typeMap.has(file.path)) {
            const handler = new Handler(file)
            await handler.extract()
            typeMap.set(file.path, handler)
          }
        }
      })
    }
  }

  /**
   * Get a mutex for each type
   * @param type the type to get the mutex for
   */
  private async getMutexForType (type: FileType) {
    if (!this.bulkMutex[type]) this.bulkMutex[type] = new Mutex()
    return await this.bulkMutex[type]!.acquire()
  }

  /**
   * Get all data from each file of type
   * @param type the type to get
   */
  public async getAllByType (type: FileType) {
    // use a mutex to only run one bulk get a time
    const release = await this.getMutexForType(type)

    if (!this.filesCache.has(type)) {
      await this.conditionallyGetByType(type)
    }

    release()
    return this.filesCache.get(type)!
  }

  /**
   * Filters the data by specific data type
   * @param type the type to get
   * @param dataType the specific data to get
   */
  public async getAllOfTypeByDataType (type: FileType, dataType: DataType) {
    let map: DefinitionLocation = new Map()

    const fileData = await this.getAllByType(type)
    for (let [ file, resourceFile ] of fileData) {
      const data = resourceFile.data.get(dataType)
      if (data) {
        for (let [ id, info ] of data) {
          map.set(id, {
            range: info.range,
            uri: vscode.Uri.file(file),
            // put this here in case I need other stuff from it
            resourceFile,
          })
        }
      }
    }

    return map
  }

  /**
   * Returns all identifiers of a type specified
   * @param type the type to find
   */
  public async getIdentifiersByFileType (type: FileType) {
    return await this.getAllOfTypeByDataType(type, DataType.Definition)
  }

  /**
   * Find a specific identifier
   * @param type the type to search
   * @param identifier the specific id
   */
  public async findByIndentifier (type: FileType, identifier: string) {
    const data = await this.getIdentifiersByFileType(type)
    const identifiers = [ ...data.keys() ]
  
    // model and materials may be parented etc
    if ((type === FileType.Material || type === FileType.Geometry) && !identifiers.includes(identifier)) {
      const id = identifiers.find(key => key.startsWith(`${identifier}:`))
      if (id) identifier = id
    }
  
    if (data.has(identifier))
      return data.get(identifier)!
  }

  /**
   * Get a texture from the string specified
   * @param path the path from which to get the texture from
   */
  public async getTexture (path: string) {
    const textures = await vscode.workspace.findFiles(`**/${path}.{png,tga}`)

    if (textures && textures.length === 1)
      return textures[0]
  }
}

export default FileHandler
