import { ConflictException, Injectable } from '@nestjs/common'

import { Application, ApplicationSelect } from './model'

import { ApplicationArgs, ApplicationCreateInput } from './dto'

import { PrismaService } from 'src/shared/datasource/prisma/prisma.service'

import validateAge, { getAge } from 'src/shared/util/refuse-by/date'

import { UserService } from '../user/user.service'

import { NotionService, NotionData } from 'src/shared/modules/crm'

import { MailService } from 'src/shared/modules/mail/mail'

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UserService,
    private readonly notionService: NotionService,
    private readonly mailService: MailService
  ) { }

  public async findOne(
    { where }: ApplicationArgs,
    { select }: ApplicationSelect,
  ): Promise<Application> {
    return this.prismaService.application.findUnique({
      where,
      select
    })
  }

  public async create(
    data: ApplicationCreateInput,
    { select }: ApplicationSelect
  ): Promise<Application> {
    if (!data.user) {
      const applicationTemplate = await this.prismaService.application.findFirst({
        where: {
          destinationId: data.destination.connect.id,
          travelAgencyId: data.travelAgency.connect.id
        }
      })

      if (applicationTemplate) {
        throw new ConflictException('This travel agency already supports this destination')
      }
    }

    const existingUserConnect = ((data.user?.connect !== undefined) && await this.userService.findOne({ where: { email: data.user?.connect?.email } }, { select: { id: true } })) ?? null
    const existingUserCreate = ((data.user?.create !== undefined) && await this.userService.findOne({ where: { email: data.user?.create?.email } }, { select: { id: true } })) ?? null

    if ((data.user?.create !== undefined) && existingUserCreate) {
      throw new ConflictException('The user already exist.')
    }

    if ((data.user?.connect !== undefined) && !existingUserConnect) {
      throw new ConflictException('The user is not registered yet.')
    }

    const attractionIDs: (string | number)[] = data.applicationAttractions.create.map(({ attraction }) => (
      attraction.connect.id ?? attraction.connect.uuid
    ))

    const selectedAttractions = await this.prismaService.attraction.findMany({
      where: {
        OR: [
          {
            id: {
              in: attractionIDs.filter((id) => typeof id === 'number') as number[]
            }
          },
          {
            uuid: {
              in: attractionIDs.filter((id) => typeof id === 'string') as string[]
            }
          }
        ]
      },
      select: {
        destination: {
          select: {
            id: true,
            uuid: true,
            name: true
          }
        },
        name: true
      }
    })

    if (selectedAttractions.length !== data.applicationAttractions.create.length) {
      throw new ConflictException('There is an attraction id that does not exist or it is a duplicate of another')
    }

    const wrongDestinationAttractions = selectedAttractions.filter(({ destination: { id, uuid } }) => (
      ((data.destination.connect.id !== undefined) && data.destination.connect.id !== id) ||
      ((data.destination.connect.uuid !== undefined) && data.destination.connect.uuid !== uuid)
    ))

    if (wrongDestinationAttractions.length) {
      throw new ConflictException('There are attractions that are not related to the destination')
    }

    if (data.user) {
      const owner = await this.prismaService.travelAgency.findUnique({
        where: {
          slug: data.travelAgency.connect.slug
        },
        select: {
          owner: {
            select: {
              email: true
            }
          }
        }
      })

      let user: string = ''
      let email: string = ''
      let phone: string = ''
      let age: number = 0

      if (existingUserConnect) {
        const fetchUser = await this.prismaService.user.findUnique({
          where: {
            email: data.user.connect.email
          },
          select: {
            email: true,
            person: {
              select: {
                firstName: true,
                lastName: true,
                birthdate: true
              }
            },
            phoneNumber: true
          }
        })
        user = `${fetchUser?.person?.firstName} ${fetchUser?.person?.lastName}`
        age = getAge(fetchUser?.person?.birthdate)
        email = `${fetchUser?.email}`
        phone = `${fetchUser?.phoneNumber}`
      } else {
        user = `${data?.user?.create?.person?.create?.firstName} ${data?.user?.create?.person?.create?.lastName}`
        age = getAge(data?.user?.create?.person?.create?.birthdate)
        email = `${data?.user?.create?.email}`
        phone = `${data?.user?.create?.phoneNumber}`
      }

      const notionData: NotionData = {
        authToken: 'secret_jn226QSSBjyjdY7fAwBE86XuLsFfKl6xoauJXhS8678',
        databaseId: '220f146bb2af4bf9a5d4954fea29dd56',
        url: 'https://api.notion.com/v1/pages',
        user: user,
        email: email,
        age: age,
        phone: phone,
        destiny: `${selectedAttractions[0]?.name}`,
        attractions: selectedAttractions.map(attraction => attraction.name).join(', '),
        from: `${data?.startDate}`,
        to: `${data?.endDate}`,
        country: `${data?.userCurrentLocation}`,
        leadSource: `${data?.leadSource}`,
        contactPreference: `${data?.contactPreference}`,
        tripObjective: `${data?.tripObjective}`,
        visa: data?.hasEntryPermission,
        passengers: data?.passengers?.create?.map(passenger => ({
          name: `${passenger.person.create.firstName} ${passenger.person.create.lastName}`,
          age: getAge(passenger.person.create.birthdate)
        }))
      }

      await this.mailService.sendEmail(this.formatEmail(data, selectedAttractions), 'cortes.ivan353@gmail.com')
      await this.notionService.updateNotion(notionData)
    }

    return this.prismaService.application.create({
      data,
      select
    })
  }

  private formatEmail(data: ApplicationCreateInput, attractions?: { destination: { id: number, uuid: string, name: string }, name: string }[]): string {
    const passengersHTML = data.passengers?.create?.map((passenger, i) => (
      `<li>
        <h3>Passenger ${i + 1}:</h3>
        <p><strong>First Name:</strong> ${passenger.person.create.firstName}</p>
        <p><strong>Last Name:</strong> ${passenger.person.create.lastName}</p>
        <p><strong>Age:</strong> ${getAge(passenger.person.create.birthdate)}</p>
      </li>`
    ))

    const attractionsHTML = attractions?.map((attraction) => (
      `<li><p>${attraction.name}</p></li>`
    ))

    const dates = {
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate)
    }

    const htmlBody = `
      <h1>New Lead Information</h1>

      <h2>User Information</h2>
      <p><strong>First Name:</strong> ${data.user.create.person.create.firstName}</p>
      <p><strong>Last Name:</strong> ${data.user.create.person.create.lastName}</p>
      <p><strong>Email:</strong> ${data.user.create.email}</p>
      <p><strong>Phone Number:</strong> ${data.user.create.phoneNumber}</p>
      <p><strong>Age:</strong> ${getAge(data.user.create.person.create.birthdate)}</p>
    
      <h2>Passengers Information</h2>
      <ul>
        ${passengersHTML}
      </ul>
      <br>

      <h2>Travel Information</h2>
      <p><strong>Destination:</strong> ${attractions[0]?.destination?.name}</p>
      <h3>Attractions</h3>
      <ul>
        ${attractionsHTML}
      </ul>
      <br>
    
      <h2>Other Information</h2>
      <p><strong>Start Date:</strong> ${dates.startDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <p><strong>End Date:</strong> ${dates.endDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <p><strong>User Current Location:</strong> ${data.userCurrentLocation}</p>
      <p><strong>Has Entry Permission:</strong> ${(data.hasEntryPermission === true) ? 'Yes' : 'No'}</p>
      <p><strong>Lead Source:</strong> ${data.leadSource}</p>
      <p><strong>Trip Objective:</strong> ${data.tripObjective}</p>
      <p><strong>Contact Preference:</strong> ${data.contactPreference}</p>
      <<br>
    `

    return htmlBody
  }
}