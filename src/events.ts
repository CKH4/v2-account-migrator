import { EventListenerOrEventListenerObject } from "../ts-client-library/packages/util/src/events"

export enum MigratorEvents {
	STATUS = "status",
	DETAILS = "details",
	WARNING = "warning",
}

type MigratorStatusEventData = { status: string }
export class MigratorStatusEvent extends CustomEvent<MigratorStatusEventData> {
	constructor (data: MigratorStatusEventData) {
		super(MigratorEvents.STATUS, { detail: data })
	}
}

type MigratorDetailsEventData = { details: string }
export class MigratorDetailsEvent extends CustomEvent<MigratorDetailsEventData> {
	constructor (data: MigratorDetailsEventData) {
		super(MigratorEvents.DETAILS, { detail: data })
	}
}

type MigratorWarningEventData = { warning: string }
export class MigratorWarningEvent extends CustomEvent<MigratorWarningEventData> {
	constructor (data: MigratorWarningEventData) {
		super(MigratorEvents.WARNING, { detail: data })
	}
}

export interface IOpaqueDownloadEvents {
	addEventListener(
		type: MigratorStatusEventData,
		listener: EventListener | EventListenerObject | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void

	addEventListener(
		type: MigratorEvents.STATUS,
		listener: EventListenerOrEventListenerObject<MigratorStatusEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: MigratorEvents.DETAILS,
		listener: EventListenerOrEventListenerObject<MigratorDetailsEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
	addEventListener(
		type: MigratorEvents.WARNING,
		listener: EventListenerOrEventListenerObject<MigratorWarningEvent> | null,
		options?: boolean | AddEventListenerOptions | undefined,
	): void
}
