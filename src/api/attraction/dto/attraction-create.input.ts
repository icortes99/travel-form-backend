import { Field, InputType } from '@nestjs/graphql'

import { MaxLength, MinLength } from 'class-validator'

import { DestinationCreateNestedOneWithoutAttractionsInput } from 'src/api/destination/dto'

import { AttractionWhereUniqueInput } from './attraction-where-unique.input'

@InputType()
export class AttractionCreateInput {
  @Field(() => String)
  name: string

  @MinLength(250)
  @MaxLength(400)
  @Field(() => String)
  description: string

  @Field(() => [String])
  images: string[]

  @Field(() => DestinationCreateNestedOneWithoutAttractionsInput)
  destination: DestinationCreateNestedOneWithoutAttractionsInput //use the connect class
}

@InputType()
export class AttractionCreateNestedOneWithoutApplicationAttractionsInput {
  @Field(() => AttractionWhereUniqueInput)
  connect: AttractionWhereUniqueInput
}

@InputType()
export class AttractionCreateNestedOneWithoutHotelsInput {
  @Field(() => AttractionWhereUniqueInput)
  connect?: AttractionWhereUniqueInput
}