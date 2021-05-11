import { posix } from "path-browserify"

import { MigratorStatusEvent, MigratorDetailsEvent, MigratorWarningEvent, MigratorErrorEvent } from "./events"

import { MasterHandle } from "../opaque/src/account"
import { FolderMeta } from "../opaque/src/core/account/folder-meta"
import { FileEntryMeta } from "../opaque/src/core/account/file-entry"

import { Account } from "../ts-client-library/packages/account-management"
import { AccountSystem, AccountSystemNotFoundError, MetadataAccess } from "../ts-client-library/packages/account-system"
import { FileSystemObject } from "../ts-client-library/packages/filesystem-access/src/filesystem-object"
import { CryptoMiddleware, NetworkMiddleware } from "../ts-client-library/packages/middleware"
import { WebAccountMiddleware, WebNetworkMiddleware } from "../ts-client-library/packages/middleware-web"
import { bytesToHex, hexToBytes } from "../ts-client-library/packages/util/src/hex"

export type AccountMigratorConfig = {
	storageNodeV1: string
	storageNodeV2: string
}

export class AccountMigrator extends EventTarget {
	config: AccountMigratorConfig

	mh: MasterHandle

	account: Account
	accountSystem: AccountSystem
	cryptoMiddleware: CryptoMiddleware
	netMiddleware: NetworkMiddleware
	metadataAccess: MetadataAccess

	_status = ""
	get status () {
		return this._status
	}

	_details = ""
	get details () {
		return this._details
	}

	constructor (handle: Uint8Array, config: AccountMigratorConfig) {
		super()

		this.config = config

		// v1
		this.mh = new MasterHandle({ handle: bytesToHex(handle) }, {
			downloadOpts: {
				endpoint: config.storageNodeV1,
			},
			uploadOpts: {
				endpoint: config.storageNodeV1,
			}
		})

		// v2
		this.cryptoMiddleware = new WebAccountMiddleware({
			asymmetricKey: handle
		})
		this.netMiddleware = new WebNetworkMiddleware()
		this.metadataAccess = new MetadataAccess({
			crypto: this.cryptoMiddleware,
			net: this.netMiddleware,
			metadataNode: config.storageNodeV2,
		})
		this.account = new Account({
			crypto: this.cryptoMiddleware,
			net: this.netMiddleware,
			storageNode: this.config.storageNodeV2,
		})
		this.accountSystem = new AccountSystem({
			metadataAccess: this.metadataAccess
		})
	}

	async migrate () {
		// TESTING
		this.setStatus("TESTING: Signing up")
		await this.account.signUp({ size: 10 })
		await this.account.waitForPayment()
		// /TESTING

		this.setStatus("Checking if account is still on v1.")
		this.setDetails("Getting v1 root folder.")
		try {
			const rootFolderV1 = await this.mh.getFolderMeta("/")
			console.log(rootFolderV1)
		} catch (err) {
			this.dispatchEvent(new MigratorErrorEvent({ error: "Account was already migrated, or has never been initialized." }))

			return
		}

		this.setDetails("")
		this.setStatus("Collecting all folders. This may take a while.")
		const allFolders = await this.collectFolderRecursively("/")
		console.log(allFolders)

		this.setDetails("")
		this.setStatus("Collecting all files.")
		const allFiles = allFolders.map((folder) => folder[1].files.map((file) => [folder[0], file] as [string, FileEntryMeta])).flat()
		console.log(allFiles)

		this.setStatus("Migrating folders.")

		try {
			this.setDetails("Initializing v2 root folder.")
			const rootFolderV2 = await this.accountSystem.addFolder("/")
			console.log(rootFolderV2)
		} catch (err) {
			if (err) {
				throw err
			}
		}

		for (let [path, folderMeta] of allFolders) {
			this.setDetails(`Initializing v2 folder "${path}".`)

			try {
				await this.accountSystem.addFolder(path)
			} catch (err) {
				this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while adding folder ("${path}") v2 metadata: ${err}.` }))
			}
		}

		this.setStatus("Migrating files.")

		for (let [path, fileMetadata] of allFiles) {
			for (let version of fileMetadata.versions) {
				const versionID = version.handle.slice(0, 4) + "..."
				this.setDetails(`Initializing file ${versionID} ("${fileMetadata.name}") in "${path}".`)

				try {
					try {
						const fileMetadataV2Location = await this.accountSystem.getFileMetadataLocationByFileHandle(hexToBytes(version.handle))
						const fileMetadata = await this.accountSystem.getFileMetadata(fileMetadataV2Location)

						if (!fileMetadata.finished) {
							await this.accountSystem.finishUpload(fileMetadataV2Location)
						}

						this.dispatchEvent(new MigratorWarningEvent({ warning: `File handle (${versionID}) already exists in v2 metadata. Keeping existing metadata.` }))
					} catch (err) {
						if (err instanceof AccountSystemNotFoundError) {
							const fileHandle = hexToBytes(version.handle)
							const fileLocation = fileHandle.slice(0, 32)
							const fileEncryptionKey = fileHandle.slice(32, 64)

							const fso = new FileSystemObject({
								handle: fileHandle,
								location: undefined,
								config: {
									crypto: this.cryptoMiddleware,
									net: this.netMiddleware,
									storageNode: this.config.storageNodeV2,
								},
							})

							const m = (await fso.exists()) ? await fso.metadata() : undefined

							const fileMetadataV2 = await this.accountSystem.addUpload(
								fileLocation,
								fileEncryptionKey,
								path,
								fileMetadata.name,
								{
									lastModified: m?.lastModified || version.modified || fileMetadata.modified || Date.now(),
									size: m?.size || version.size,
									type: m?.type || "",
								},
								false,
							)

							await this.accountSystem.finishUpload(fileMetadataV2.location)
						} else {
							this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while adding file ${versionID} v2 metadata: ${err}` }))
						}
					}
				} catch (err) {
					this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error for file ${versionID}: ${err}` }))
				}
			}
		}

		this.setDetails("")
		this.setStatus("Finished.")
	}

	private async collectFolderRecursively (path: string, out: [string, FolderMeta][] = []) {
		let output = out.slice()

		this.setDetails(`Getting v1 folder "${path}".`)

		try {
			const fm = await this.mh.getFolderMeta(path)

			output = output.concat([[path, fm]])

			for (let f of fm.folders) {
				const subPath = posix.join(path, f.name)
				output = output.concat(await this.collectFolderRecursively(subPath))
			}
		} catch (err) {
			this.dispatchEvent(new MigratorErrorEvent({ error: `Recieved unknown error while collecting folder ("${path}") v1 metadata: ${err}.` }))
		} finally {
			return output
		}
	}

	private setStatus (status: string) {
		this.dispatchEvent(new MigratorStatusEvent({ status }))
		this._status = status
	}

	private setDetails (details: string) {
		this.dispatchEvent(new MigratorDetailsEvent({ details: details }))
		this._details = details
	}
}
